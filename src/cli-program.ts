import {
  CliUsageError,
  buildToolInput,
  normalizeCliPaths,
  parseInvocation,
  unknownCommandError,
  type ParsedInvocation,
} from "./cli/args.js";
import { commandHelp, generalHelp } from "./cli/help.js";
import {
  CLI_EXIT_CODES,
  type LifecycleCommandName,
} from "./cli/metadata.js";
import { MAX_SESSION_EXECUTION_TIMEOUT_MS } from "./cli/timeouts.js";
import type { SessionState } from "./cli/session.js";
import type { McpServerLike } from "./mcp/adapter.js";
import {
  formatToolData,
  getToolDefinitions,
  getToolSpec,
  getToolSpecs,
  readOnlyToolMessage,
  unknownToolMessage,
  validateToolInput,
  type ToolSpec,
} from "./tools/registry.js";
import type { ToolResult } from "./types.js";
import { VERSION } from "./version.js";

const DAEMON_STARTUP_TIMEOUT = 10_000;
const SESSION_STATUS_TIMEOUT = 500;
const DEFAULT_OPERATION_TIMEOUT = 10_000;
const MAX_SEQUENTIAL_OPERATION_PHASES = 8;
const REQUEST_TIMEOUT_MARGIN = 15_000;

let sessionModule: Promise<typeof import("./cli/session.js")> | undefined;

function loadSessionModule(): Promise<typeof import("./cli/session.js")> {
  return sessionModule ??= import("./cli/session.js");
}

function protocolError(value: string, cause?: unknown): Error {
  const error = new Error(value, { cause });
  error.name = "SessionProtocolError";
  return error;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function writeLine(value: string, stream: NodeJS.WriteStream = process.stdout): void {
  stream.write(`${value}\n`);
}

function errorExitCode(error: unknown): number {
  const name = error instanceof Error ? error.name : "";
  const code = typeof error === "object" && error !== null
    ? (error as NodeJS.ErrnoException).code ?? ""
    : "";
  if (error instanceof CliUsageError) return CLI_EXIT_CODES.usage.code;
  if (name === "SessionStateError") return CLI_EXIT_CODES.browser.code;
  if (/Chrome|CDPConnection|Navigation/.test(name)) {
    return CLI_EXIT_CODES.browser.code;
  }
  if (
    name === "SessionProtocolError" ||
    /Protocol|Socket|ECONN|EPIPE/.test(name) ||
    /^(?:ECONN|EPIPE|ENOENT)/.test(code)
  ) {
    return CLI_EXIT_CODES.protocol.code;
  }
  return CLI_EXIT_CODES.tool.code;
}

function printError(error: unknown): void {
  writeLine(`tidesurf: ${message(error)}`, process.stderr);
}

function requestTimeout(
  invocation: ParsedInvocation,
  input?: Record<string, unknown>
): number {
  const toolTimeout = typeof input?.["timeout"] === "number" ? input["timeout"] : 0;
  const operationTimeout = invocation.sessionConfig.timeout ?? DEFAULT_OPERATION_TIMEOUT;
  const timeout = Math.max(
    60_000,
    operationTimeout * MAX_SEQUENTIAL_OPERATION_PHASES +
      toolTimeout +
      REQUEST_TIMEOUT_MARGIN
  );
  if (!Number.isSafeInteger(timeout) || timeout > MAX_SESSION_EXECUTION_TIMEOUT_MS) {
    throw new CliUsageError(
      `Timeout budget exceeds the session transport limit of ${MAX_SESSION_EXECUTION_TIMEOUT_MS}ms`
    );
  }
  return timeout;
}

function preflightToolInput(
  tool: ToolSpec,
  input: Record<string, unknown>,
  policy: SessionState["config"]
): void {
  try {
    validateToolInput(tool, input, {
      allowLocalhost: policy.allowLocalhost,
      allowPrivateHosts: policy.allowPrivateHosts,
    });
  } catch (error) {
    throw new CliUsageError(message(error));
  }
}

async function sessionPolicy(
  invocation: ParsedInvocation
): Promise<SessionState["config"]> {
  const {
    ensureSessionRequest,
    getSessionPaths,
    isProcessRunning,
    readSessionState,
  } =
    await loadSessionModule();
  const candidate = readSessionState(getSessionPaths(invocation.session));
  if (!candidate?.ready || !isProcessRunning(candidate.pid)) {
    return invocation.sessionConfig;
  }
  const { state } = await ensureSessionRequest(
    sessionOptions(invocation),
    { method: "status" },
    SESSION_STATUS_TIMEOUT
  );
  return state.config;
}

function readOnlyFailure(
  policy: SessionState["config"],
  tool: ToolSpec
): ToolResult | undefined {
  return policy.readOnly && !tool.readOnlyAllowed
    ? { success: false, error: readOnlyToolMessage(tool) }
    : undefined;
}

function sessionOptions(invocation: ParsedInvocation) {
  return {
    session: invocation.session,
    config: invocation.sessionConfig,
    timeoutMs: DAEMON_STARTUP_TIMEOUT,
    expectedConfig: invocation.startupConfig,
  };
}

async function outputScreenshot(
  result: ToolResult,
  output: string | undefined,
  json: boolean
): Promise<ToolResult> {
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

  const [fs, os, path, crypto] = await Promise.all([
    import("node:fs"),
    import("node:os"),
    import("node:path"),
    import("node:crypto"),
  ]);
  const filePath = output
    ? path.resolve(output)
    : path.resolve(os.tmpdir(), `tidesurf-screenshot-${crypto.randomUUID()}.png`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, bytes);
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
    writeLine(formatToolData(result.data));
  } else {
    writeLine(result.error ?? "Tool failed", process.stderr);
  }
  return result.success ? CLI_EXIT_CODES.success.code : CLI_EXIT_CODES.tool.code;
}

async function executeToolCommand(
  invocation: ParsedInvocation,
  tool: ToolSpec,
  readInput: () => Record<string, unknown> | Promise<Record<string, unknown>>,
  screenshotOutput?: string
): Promise<number> {
  if (tool.outputKind === "image" && screenshotOutput === "-" && invocation.json) {
    throw new CliUsageError("--output - cannot be combined with --json");
  }
  const policy = await sessionPolicy(invocation);
  const denied = readOnlyFailure(policy, tool);
  if (denied) return printToolResult(denied, invocation.json);
  const input = await readInput();
  preflightToolInput(tool, input, policy);
  const { ensureSessionRequest, toToolResult } = await loadSessionModule();
  const { data: response } = await ensureSessionRequest<ToolResult>(
    sessionOptions(invocation),
    { method: "tool", name: tool.name, input },
    requestTimeout(invocation, input)
  );
  let result = toToolResult(response);
  if (tool.outputKind === "image") {
    result = await outputScreenshot(
      result,
      screenshotOutput,
      invocation.json
    );
  }
  if (tool.outputKind === "image" && screenshotOutput === "-" && result.success) {
    return 0;
  }
  return printToolResult(result, invocation.json);
}

async function runTool(invocation: ParsedInvocation): Promise<number> {
  return executeToolCommand(
    invocation,
    invocation.tool!,
    () => buildToolInput(invocation),
    invocation.screenshotOutput
  );
}

async function readCallInput(value: string | undefined): Promise<Record<string, unknown>> {
  if (value === undefined) throw new CliUsageError("call requires --input <json|->");
  const raw = value === "-"
    ? (await import("node:fs")).readFileSync(0, "utf8")
    : value;
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
  const spec = getToolSpec(name);
  if (!spec) {
    throw new CliUsageError(unknownToolMessage(name));
  }
  return executeToolCommand(
    invocation,
    spec,
    async () => normalizeCliPaths(
      spec,
      await readCallInput(invocation.callInput)
    )
  );
}

async function startSession(invocation: ParsedInvocation): Promise<number> {
  if (invocation.positionals.length) throw new CliUsageError("start takes no arguments");
  const { ensureSessionRequest } = await loadSessionModule();
  const { data: status } = await ensureSessionRequest(
    sessionOptions(invocation),
    { method: "start" },
    requestTimeout(invocation)
  );
  writeLine(invocation.json ? JSON.stringify({ success: true, data: status }, null, 2) : formatToolData(status));
  return 0;
}

async function statusSession(invocation: ParsedInvocation): Promise<number> {
  if (invocation.positionals.length) throw new CliUsageError("status takes no arguments");
  const { sendLiveSessionRequest } = await loadSessionModule();
  const response = await sendLiveSessionRequest(
    invocation.session,
    { method: "status" },
    SESSION_STATUS_TIMEOUT
  );
  if (!response) {
    const data = { session: invocation.session, running: false };
    writeLine(invocation.json ? JSON.stringify({ success: true, data }, null, 2) : `Session ${invocation.session} is stopped.`);
    return 0;
  }
  const status = response.data;
  writeLine(invocation.json ? JSON.stringify({ success: true, data: status }, null, 2) : formatToolData(status));
  return 0;
}

async function stopSession(invocation: ParsedInvocation): Promise<number> {
  if (invocation.positionals.length) throw new CliUsageError("stop takes no arguments");
  const {
    isProcessRunning,
    sendLiveSessionRequest,
  } = await loadSessionModule();
  const response = await sendLiveSessionRequest(
    invocation.session,
    { method: "stop" },
    requestTimeout(invocation)
  );
  const state = response?.state;
  const data = response
    ? response.data
    : { stopped: true, session: invocation.session, alreadyStopped: true };
  if (state) {
    const deadline = Date.now() + 12_000;
    while (isProcessRunning(state.pid) && Date.now() < deadline) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
    }
    if (isProcessRunning(state.pid)) {
      throw protocolError(`Session ${invocation.session} did not stop cleanly`);
    }
  }
  writeLine(invocation.json ? JSON.stringify({ success: true, data }, null, 2) : `Session ${invocation.session} stopped.`);
  return 0;
}

function listTools(invocation: ParsedInvocation): number {
  if (invocation.positionals.length) throw new CliUsageError("tools takes no arguments");
  if (invocation.json) {
    writeLine(JSON.stringify({ success: true, data: getToolDefinitions() }, null, 2));
  } else {
    writeLine(getToolSpecs()
      .map((tool) => `${tool.name}\t${tool.description}`)
      .join("\n"));
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
  const policy = invocation.sessionConfig;
  const denied = readOnlyFailure(policy, navigationSpec);
  if (denied) return printToolResult(denied, invocation.json);
  preflightToolInput(navigationSpec, { url }, policy);
  const stateSpec = getToolSpec("get_state")!;
  const input = buildToolInput({
    ...invocation,
    tool: stateSpec,
    positionals: [],
  });
  preflightToolInput(stateSpec, input, policy);
  const { BrowserController } = await import("./cli/browser-controller.js");
  const controller = new BrowserController(invocation.sessionConfig);
  try {
    const browser = await controller.getBrowser();
    await browser.navigate(url);
    return printToolResult(
      await controller.execute("get_state", input),
      invocation.json
    );
  } finally {
    await controller.close();
  }
}

async function runMcp(invocation: ParsedInvocation): Promise<number> {
  if (invocation.positionals.length) throw new CliUsageError("mcp takes no arguments");
  const mcpPath = "@modelcontextprotocol/sdk/server/mcp.js";
  const stdioPath = "@modelcontextprotocol/sdk/server/stdio.js";
  const zodPath = "zod";
  type McpRuntimeServer = McpServerLike & {
    connect(transport: unknown): Promise<void>;
    close(): Promise<void>;
  };
  let externalModules: [
    { McpServer: new (info: { name: string; version: string }) => McpRuntimeServer },
    { StdioServerTransport: new () => unknown },
    { z: { fromJSONSchema(schema: unknown): unknown } },
  ];
  try {
    externalModules = await Promise.all([
      import(mcpPath),
      import(stdioPath),
      import(zodPath),
    ]) as typeof externalModules;
  } catch (error) {
    throw protocolError(
      "MCP dependencies are unavailable. Install @modelcontextprotocol/sdk and zod.",
      error
    );
  }

  const [{ McpServer }, { StdioServerTransport }, { z }] = externalModules;
  const [
    { createZodInputSchemaFactory, registerMcpTools },
    { BrowserController },
  ] = await Promise.all([
    import("./mcp/adapter.js"),
    import("./cli/browser-controller.js"),
  ]);
  const server = new McpServer({ name: "tidesurf", version: VERSION });
  const controller = new BrowserController(invocation.sessionConfig);
  registerMcpTools({
    server,
    coordinator: controller,
    createInputSchema: createZodInputSchemaFactory(z),
    readOnly: invocation.sessionConfig.readOnly,
  });

  let closingPromise: Promise<void> | null = null;
  const close = () => {
    closingPromise ??= Promise.all([
      controller.close(),
      server.close(),
    ]).then(() => undefined);
    return closingPromise;
  };
  const shutdown = (code: number) => {
    void close()
      .catch(printError)
      .finally(() => process.exit(code));
  };
  let inputEnded = false;
  const closeOnInputEnd = () => {
    if (inputEnded) return;
    inputEnded = true;
    void close().catch((error) => {
      printError(error);
      process.exitCode = CLI_EXIT_CODES.protocol.code;
    });
  };
  process.once("SIGINT", () => shutdown(130));
  process.once("SIGTERM", () => shutdown(143));
  process.stdin.once("end", closeOnInputEnd);
  process.stdin.once("close", closeOnInputEnd);
  try {
    await server.connect(new StdioServerTransport());
  } catch (error) {
    try {
      await close();
    } catch (closeError) {
      printError(closeError);
    }
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

type LifecycleHandler = (
  invocation: ParsedInvocation
) => number | Promise<number>;

const LIFECYCLE_HANDLERS = {
  start: startSession,
  status: statusSession,
  stop: stopSession,
  tools: listTools,
  call: callTool,
  inspect,
  mcp: runMcp,
  help: showHelp,
} satisfies Record<LifecycleCommandName, LifecycleHandler>;

async function dispatch(invocation: ParsedInvocation): Promise<number> {
  if (invocation.version) {
    writeLine(VERSION);
    return 0;
  }
  if (!invocation.command) {
    writeLine(generalHelp());
    return 0;
  }
  if (invocation.help) return showHelp(invocation);
  if (invocation.tool) return runTool(invocation);
  return LIFECYCLE_HANDLERS[invocation.command as LifecycleCommandName](invocation);
}

async function main(argv: string[]): Promise<number> {
  return dispatch(parseInvocation(argv));
}

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

export function runCliProcess(argv: string[]): void {
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
}
