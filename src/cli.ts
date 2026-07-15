#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  CliUsageError,
  buildToolInput,
  normalizeCliPaths,
  parseInvocation,
  unknownCommandError,
  type ParsedInvocation,
} from "./cli/args.js";
import { BrowserController } from "./cli/browser-controller.js";
import { runDaemon } from "./cli/daemon.js";
import { commandHelp, generalHelp } from "./cli/help.js";
import {
  SessionProtocolError,
  SessionStateError,
  ensureSession,
  getSessionPaths,
  getLiveSession,
  isProcessRunning,
  readSessionState,
  removeSessionFiles,
  sendSessionRequest,
  toToolResult,
  type SessionState,
} from "./cli/session.js";
import { createZodInputSchemaFactory, registerMcpTools, type McpServerLike } from "./mcp/index.js";
import {
  getToolDefinitions,
  getToolSpec,
  getToolSpecByCommand,
  getToolSpecs,
  readOnlyToolMessage,
  unknownToolMessage,
  validateToolInput,
  type ToolSpec,
} from "./tools/registry.js";
import type { ToolResult } from "./types.js";
import { VERSION } from "./version.js";

const EXIT_USAGE = 2;
const EXIT_BROWSER = 3;
const EXIT_TOOL = 4;
const EXIT_PROTOCOL = 5;
const DAEMON_STARTUP_TIMEOUT = 10_000;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function writeLine(value: string, stream: NodeJS.WriteStream = process.stdout): void {
  stream.write(`${value}\n`);
}

function pretty(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "OK";
  return JSON.stringify(value, null, 2) ?? String(value);
}

function errorExitCode(error: unknown): number {
  const name = error instanceof Error ? error.name : "";
  const code = (error as NodeJS.ErrnoException).code ?? "";
  if (error instanceof CliUsageError) return EXIT_USAGE;
  if (error instanceof SessionStateError) return EXIT_BROWSER;
  if (/Chrome|CDPConnection|Navigation/.test(name)) return EXIT_BROWSER;
  if (
    error instanceof SessionProtocolError ||
    /Protocol|Socket|ECONN|EPIPE/.test(name) ||
    /^(?:ECONN|EPIPE|ENOENT)/.test(code)
  ) {
    return EXIT_PROTOCOL;
  }
  return EXIT_TOOL;
}

function printError(error: unknown): void {
  writeLine(`tidesurf: ${message(error)}`, process.stderr);
}

function requestTimeout(
  invocation: ParsedInvocation,
  input?: Record<string, unknown>
): number {
  const toolTimeout = typeof input?.["timeout"] === "number" ? input["timeout"] : 0;
  return Math.max(
    60_000,
    (invocation.sessionConfig.timeout ?? 0) + 15_000,
    toolTimeout + 15_000
  );
}

function preflightToolInput(
  tool: ToolSpec,
  input: Record<string, unknown>,
  policy: SessionState["config"]
): void {
  try {
    validateToolInput(tool, input, {
      getUrlValidationOptions: () => ({
        allowLocalhost: policy.allowLocalhost,
        allowPrivateHosts: policy.allowPrivateHosts,
      }),
    });
  } catch (error) {
    throw new CliUsageError(message(error));
  }
}

function sessionPolicy(
  invocation: ParsedInvocation,
  useExistingSession = true
): SessionState["config"] {
  if (!useExistingSession) return invocation.sessionConfig;
  const candidate = readSessionState(getSessionPaths(invocation.session));
  return candidate?.ready && isProcessRunning(candidate.pid)
    ? candidate.config
    : invocation.sessionConfig;
}

function readOnlyFailure(
  policy: SessionState["config"],
  tool: ToolSpec
): ToolResult | undefined {
  return policy.readOnly && !tool.readOnlyAllowed
    ? { success: false, error: readOnlyToolMessage(tool) }
    : undefined;
}

async function runningSession(invocation: ParsedInvocation): Promise<SessionState> {
  return ensureSession({
    session: invocation.session,
    config: invocation.sessionConfig,
    timeoutMs: DAEMON_STARTUP_TIMEOUT,
    expectedConfig: invocation.startupConfig,
  });
}

function outputScreenshot(
  result: ToolResult,
  output: string | undefined,
  json: boolean
): ToolResult {
  if (!result.success) return result;
  if (typeof result.data !== "string") {
    return {
      success: false,
      error: "Screenshot did not return PNG data",
      errorType: "SessionProtocolError",
    };
  }
  const bytes = Buffer.from(result.data, "base64");
  if (output === "-") {
    process.stdout.write(bytes);
    return { success: true, data: undefined };
  }

  const filePath = output
    ? resolve(output)
    : resolve(tmpdir(), `tidesurf-screenshot-${randomUUID()}.png`);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, bytes);
  return {
    success: true,
    data: json
      ? { filePath, mimeType: "image/png", totalBytes: bytes.byteLength }
      : filePath,
  };
}

function printToolResult(result: ToolResult, json: boolean): number {
  if (json) {
    writeLine(
      JSON.stringify(result, null, 2),
      result.success ? process.stdout : process.stderr
    );
  } else if (result.success) {
    writeLine(pretty(result.data));
  } else {
    writeLine(result.error ?? "Tool failed", process.stderr);
  }
  return result.success ? 0 : EXIT_TOOL;
}

async function runTool(invocation: ParsedInvocation): Promise<number> {
  const tool = invocation.tool!;
  if (tool.outputKind === "image" && invocation.screenshotOutput === "-" && invocation.json) {
    throw new CliUsageError("--output - cannot be combined with --json");
  }
  const policy = sessionPolicy(invocation);
  const denied = readOnlyFailure(policy, tool);
  if (denied) return printToolResult(denied, invocation.json);
  const input = buildToolInput(invocation);
  preflightToolInput(tool, input, policy);
  const state = await runningSession(invocation);
  const response = await sendSessionRequest<ToolResult>(
    state,
    { method: "tool", name: tool.name, input },
    requestTimeout(invocation, input)
  );
  const result = tool.outputKind === "image"
    ? outputScreenshot(toToolResult(response), invocation.screenshotOutput, invocation.json)
    : toToolResult(response);
  if (tool.outputKind === "image" && invocation.screenshotOutput === "-" && result.success) {
    return 0;
  }
  return printToolResult(result, invocation.json);
}

async function readCallInput(value: string | undefined): Promise<Record<string, unknown>> {
  if (value === undefined) throw new CliUsageError("call requires --input <json|->");
  const raw = value === "-" ? readFileSync(0, "utf8") : value;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new CliUsageError(`Invalid JSON input: ${message(error)}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CliUsageError("Tool input must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

async function callTool(invocation: ParsedInvocation): Promise<number> {
  const name = invocation.positionals[0];
  if (!name) throw new CliUsageError("call requires a tool name");
  if (invocation.positionals.length > 1) {
    throw new CliUsageError(`Unexpected argument: ${invocation.positionals[1]}`);
  }
  const spec = getToolSpec(name) ?? getToolSpecByCommand(name);
  if (!spec) {
    throw new CliUsageError(unknownToolMessage(name));
  }
  const policy = sessionPolicy(invocation);
  const denied = readOnlyFailure(policy, spec);
  if (denied) return printToolResult(denied, invocation.json);
  const input = normalizeCliPaths(spec, await readCallInput(invocation.callInput));
  preflightToolInput(spec, input, policy);
  const state = await runningSession(invocation);
  const result = toToolResult(await sendSessionRequest<ToolResult>(
    state,
    { method: "tool", name: spec.name, input },
    requestTimeout(invocation, input)
  ));
  const output = spec.outputKind === "image"
    ? outputScreenshot(result, undefined, invocation.json)
    : result;
  return printToolResult(output, invocation.json);
}

async function startSession(invocation: ParsedInvocation): Promise<number> {
  if (invocation.positionals.length) throw new CliUsageError("start takes no arguments");
  const state = await runningSession(invocation);
  const status = await sendSessionRequest(state, { method: "start" }, requestTimeout(invocation));
  writeLine(invocation.json ? JSON.stringify({ success: true, data: status }, null, 2) : pretty(status));
  return 0;
}

async function statusSession(invocation: ParsedInvocation): Promise<number> {
  if (invocation.positionals.length) throw new CliUsageError("status takes no arguments");
  const state = await getLiveSession(invocation.session);
  if (!state) {
    const data = { session: invocation.session, running: false };
    writeLine(invocation.json ? JSON.stringify({ success: true, data }, null, 2) : `Session ${invocation.session} is stopped.`);
    return 0;
  }
  const status = await sendSessionRequest(state, { method: "status" }, requestTimeout(invocation));
  writeLine(invocation.json ? JSON.stringify({ success: true, data: status }, null, 2) : pretty(status));
  return 0;
}

async function stopSession(invocation: ParsedInvocation): Promise<number> {
  if (invocation.positionals.length) throw new CliUsageError("stop takes no arguments");
  const state = await getLiveSession(invocation.session);
  const data = state
    ? await sendSessionRequest(state, { method: "stop" }, requestTimeout(invocation))
    : { stopped: true, session: invocation.session, alreadyStopped: true };
  if (state) {
    const deadline = Date.now() + 12_000;
    while (isProcessRunning(state.pid) && Date.now() < deadline) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
    }
    if (isProcessRunning(state.pid)) {
      throw new SessionProtocolError(`Session ${invocation.session} did not stop cleanly`);
    }
    removeSessionFiles(getSessionPaths(invocation.session), true);
  }
  writeLine(invocation.json ? JSON.stringify({ success: true, data }, null, 2) : `Session ${invocation.session} stopped.`);
  return 0;
}

function listTools(invocation: ParsedInvocation): number {
  if (invocation.positionals.length) throw new CliUsageError("tools takes no arguments");
  if (invocation.json) {
    writeLine(JSON.stringify({ success: true, data: getToolDefinitions() }, null, 2));
  } else {
    for (const tool of getToolSpecs()) {
      const alias = tool.cli.aliases.length ? ` (${tool.cli.aliases.join(", ")})` : "";
      writeLine(`${tool.cli.command}${alias}\t${tool.description}`);
    }
  }
  return 0;
}

async function inspect(invocation: ParsedInvocation): Promise<number> {
  const url = invocation.positionals[0];
  if (!url) throw new CliUsageError("inspect requires a URL");
  if (invocation.positionals.length > 1) {
    throw new CliUsageError(`Unexpected argument: ${invocation.positionals[1]}`);
  }
  const navigationSpec = getToolSpec("navigate")!;
  const policy = sessionPolicy(invocation, false);
  const denied = readOnlyFailure(policy, navigationSpec);
  if (denied) return printToolResult(denied, invocation.json);
  preflightToolInput(navigationSpec, { url }, policy);
  const input: Record<string, unknown> = {};
  if (invocation.values["maxTokens"] !== undefined) input["maxTokens"] = invocation.values["maxTokens"];
  if (invocation.values["mode"] !== undefined) input["mode"] = invocation.values["mode"];
  if (invocation.values["fullPage"]) input["viewport"] = false;
  if (invocation.values["includeHidden"] !== undefined) input["includeHidden"] = invocation.values["includeHidden"];
  preflightToolInput(getToolSpec("get_state")!, input, policy);
  const controller = new BrowserController(invocation.sessionConfig);
  try {
    const browser = await controller.getBrowser();
    await browser.navigate(url);
    const execute = await controller.executor();
    return printToolResult(await execute({ name: "get_state", input }), invocation.json);
  } finally {
    await controller.close();
  }
}

async function runMcp(invocation: ParsedInvocation): Promise<number> {
  if (invocation.positionals.length) throw new CliUsageError("mcp takes no arguments");
  const mcpPath = "@modelcontextprotocol/sdk/server/mcp.js";
  const stdioPath = "@modelcontextprotocol/sdk/server/stdio.js";
  const zodPath = "zod";
  let modules: [{ McpServer: new (info: { name: string; version: string }) => unknown }, { StdioServerTransport: new () => unknown }, { z: { fromJSONSchema(schema: unknown): unknown } }];
  try {
    modules = await Promise.all([import(mcpPath), import(stdioPath), import(zodPath)]) as typeof modules;
  } catch {
    throw new SessionProtocolError("MCP dependencies are unavailable. Install @modelcontextprotocol/sdk and zod.");
  }

  const [{ McpServer }, { StdioServerTransport }, { z }] = modules;
  const server = new McpServer({ name: "tidesurf", version: VERSION });
  const controller = new BrowserController(invocation.sessionConfig);
  registerMcpTools({
    server: server as McpServerLike,
    coordinator: controller,
    createInputSchema: createZodInputSchemaFactory(z),
    readOnly: invocation.sessionConfig.readOnly,
  });

  let closingPromise: Promise<void> | null = null;
  const close = () => {
    closingPromise ??= Promise.all([
      controller.close(),
      (server as { close?(): Promise<void> }).close?.() ?? Promise.resolve(),
    ]).then(() => undefined);
    return closingPromise;
  };
  const shutdown = (code: number) => {
    void close().finally(() => process.exit(code));
  };
  let inputEnded = false;
  const closeOnInputEnd = () => {
    if (inputEnded) return;
    inputEnded = true;
    void close().catch((error) => {
      printError(error);
      process.exitCode = EXIT_PROTOCOL;
    });
  };
  process.once("SIGINT", () => shutdown(130));
  process.once("SIGTERM", () => shutdown(143));
  process.stdin.once("end", closeOnInputEnd);
  process.stdin.once("close", closeOnInputEnd);
  try {
    await (server as { connect(transport: unknown): Promise<void> }).connect(
      new StdioServerTransport()
    );
  } catch (error) {
    await close().catch(() => {});
    throw error;
  }
  if (!invocation.quiet) writeLine("[tidesurf] MCP server ready on stdio", process.stderr);
  return 0;
}

function showHelp(invocation: ParsedInvocation): number {
  const target = invocation.command === "help"
    ? invocation.positionals[0]
    : invocation.command;
  if (invocation.command === "help" && invocation.positionals.length > 1) {
    throw new CliUsageError(`Unexpected argument: ${invocation.positionals[1]}`);
  }
  if (target === undefined) {
    writeLine(generalHelp());
    return 0;
  }
  const help = commandHelp(target);
  if (!help) throw unknownCommandError(target);
  writeLine(help);
  return 0;
}

async function dispatch(invocation: ParsedInvocation): Promise<number> {
  if (invocation.version) {
    writeLine(VERSION);
    return 0;
  }
  if (!invocation.command) {
    writeLine(generalHelp());
    return 0;
  }
  if (invocation.help || invocation.command === "help") return showHelp(invocation);
  if (invocation.tool) return runTool(invocation);
  switch (invocation.command) {
    case "start": return startSession(invocation);
    case "status": return statusSession(invocation);
    case "stop": return stopSession(invocation);
    case "tools": return listTools(invocation);
    case "call": return callTool(invocation);
    case "inspect": return inspect(invocation);
    case "mcp": return runMcp(invocation);
    default: throw unknownCommandError(invocation.command);
  }
}

async function main(argv: string[]): Promise<number> {
  if (argv[0] === "__daemon") {
    const stateIndex = argv.indexOf("--state-file");
    const stateFile = stateIndex === -1 ? undefined : argv[stateIndex + 1];
    if (!stateFile) throw new SessionProtocolError("Daemon requires --state-file");
    await runDaemon(stateFile);
    return 0;
  }
  return dispatch(parseInvocation(argv));
}

const argv = process.argv.slice(2);

function jsonOutputRequested(args: readonly string[]): boolean {
  let enabled = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--") break;
    if (argument === "--no-json") {
      const next = args[index + 1];
      if (next === "true" || next === "false") {
        enabled = next === "false";
        index++;
      } else {
        enabled = false;
      }
      continue;
    }
    if (argument.startsWith("--no-json=")) {
      enabled = argument.slice("--no-json=".length) === "false";
      continue;
    }
    if (argument === "--json") {
      const next = args[index + 1];
      if (next === "true" || next === "false") {
        enabled = next === "true";
        index++;
      } else {
        enabled = true;
      }
      continue;
    }
    if (argument.startsWith("--json=")) {
      enabled = argument.slice("--json=".length) !== "false";
    }
  }
  return enabled;
}

main(argv).then(
  (code) => { process.exitCode = code; },
  (error) => {
    if (jsonOutputRequested(argv)) {
      writeLine(JSON.stringify({
        success: false,
        error: message(error),
        errorType: error instanceof Error ? error.name : "Error",
      }, null, 2), process.stderr);
    } else {
      printError(error);
      if (error instanceof CliUsageError) {
        writeLine("Run 'tidesurf help' for usage.", process.stderr);
      }
    }
    process.exitCode = errorExitCode(error);
  }
);
