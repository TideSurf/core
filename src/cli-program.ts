import {
  CliUsageError,
  buildToolInput,
  jsonOutputRequested,
  normalizeCliPaths,
  parseInvocation,
  unknownCommandError,
  type ParsedInvocation,
} from "./cli/args.js";
import { commandHelp, generalHelp } from "./cli/help.js";
import {
  CLI_ERROR_EXIT_CODES,
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
  executeValidatedToolSpec,
  readOnlyToolMessage,
  unknownToolMessage,
  validateToolInput,
  type ToolSpec,
} from "./tools/registry.js";
import type { ReadPageOptions, ToolResult } from "./types.js";
import { VERSION } from "./version.js";

const DAEMON_STARTUP_TIMEOUT = 10_000;
const SESSION_STATUS_TIMEOUT = 500;
const MCP_CLOSE_GRACE_MS = 5_000;
const MCP_STARTUP_QUEUE_MAX_MESSAGES = 128;
const MCP_STARTUP_QUEUE_MAX_BYTES = 1024 * 1024;
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
  const mapped: number | undefined = CLI_ERROR_EXIT_CODES[name];
  if (mapped !== undefined) return mapped;
  const code = typeof error === "object" && error !== null
    ? (error as NodeJS.ErrnoException).code ?? ""
    : "";
  return /^(?:ECONN|EPIPE|ENOENT)/.test(code)
    ? CLI_EXIT_CODES.protocol.code
    : CLI_EXIT_CODES.tool.code;
}

function printError(error: unknown): void {
  writeLine(`tidesurf: ${message(error)}`, process.stderr);
}

function requestTimeout(
  config: SessionState["config"],
  input?: Record<string, unknown>
): number {
  const toolTimeout = typeof input?.["timeout"] === "number" ? input["timeout"] : 0;
  const operationTimeout = config.timeout ?? DEFAULT_OPERATION_TIMEOUT;
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

/**
 * The daemon's persisted config drives the request budget: a running
 * session may legitimately work for multiples of its own timeout, not the
 * local process defaults.
 */
async function effectiveSessionConfig(
  invocation: ParsedInvocation
): Promise<SessionState["config"]> {
  const { getSessionPaths, isProcessRunning, readSessionState } =
    await loadSessionModule();
  const state = readSessionState(getSessionPaths(invocation.session));
  return state && isProcessRunning(state.pid)
    ? state.config
    : invocation.sessionConfig;
}

async function sessionPolicy(
  invocation: ParsedInvocation
): Promise<SessionState["config"]> {
  const {
    ensureSessionRequest,
    getSessionPaths,
    isProcessRunning,
    readSessionState,
    SessionProtocolError,
  } =
    await loadSessionModule();
  const candidate = readSessionState(getSessionPaths(invocation.session));
  if (!candidate?.ready || !isProcessRunning(candidate.pid)) {
    return invocation.sessionConfig;
  }
  try {
    const { state } = await ensureSessionRequest(
      sessionOptions(invocation),
      { method: "status" },
      SESSION_STATUS_TIMEOUT
    );
    return state.config;
  } catch (error) {
    // A slow-to-answer daemon (event loop busy serializing a large DOM,
    // loaded machine) must not hard-fail the whole command on a 500ms probe:
    // fall back to local config and let the actual tool request proceed with
    // its own budget. The daemon enforces read-only and URL policy
    // authoritatively server-side, so the local fallback is advisory only.
    if (error instanceof SessionProtocolError) {
      return invocation.sessionConfig;
    }
    throw error;
  }
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

function printSuccess(json: boolean, data: unknown, text: string): void {
  writeLine(json ? JSON.stringify({ success: true, data }, null, 2) : text);
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
  const browserFree = tool.requiresBrowser === false;
  const policy = browserFree
    ? invocation.sessionConfig
    : await sessionPolicy(invocation);
  const denied = readOnlyFailure(policy, tool);
  if (denied) return printToolResult(denied, invocation.json);
  const input = await readInput();
  preflightToolInput(tool, input, policy);
  let result: ToolResult;
  if (browserFree) {
    // Extension discovery belongs to the invoking process's cwd/environment;
    // routing it through a persistent daemon leaks stale project policy and
    // needlessly pins browser startup options before a browser is requested.
    result = await executeValidatedToolSpec(null, tool, input);
  } else {
    const { ensureSessionRequest, toToolResult } = await loadSessionModule();
    const { data: response } = await ensureSessionRequest<ToolResult>(
      sessionOptions(invocation),
      { method: "tool", name: tool.name, input },
      requestTimeout(policy, input)
    );
    result = toToolResult(response);
  }
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
    requestTimeout(await effectiveSessionConfig(invocation))
  );
  printSuccess(invocation.json, status, formatToolData(status));
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
    printSuccess(invocation.json, data, `Session ${invocation.session} is stopped.`);
    return 0;
  }
  const status = response.data;
  printSuccess(invocation.json, status, formatToolData(status));
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
    requestTimeout(await effectiveSessionConfig(invocation))
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
  printSuccess(invocation.json, data, `Session ${invocation.session} stopped.`);
  return 0;
}

function listTools(invocation: ParsedInvocation): number {
  if (invocation.positionals.length) throw new CliUsageError("tools takes no arguments");
  printSuccess(
    invocation.json,
    getToolDefinitions(),
    getToolSpecs()
      .map((tool) => `${tool.name}\t${tool.description}`)
      .join("\n")
  );
  return 0;
}

async function loadExtensionsModule() {
  return import("./extensions/index.js");
}

async function listSkills(invocation: ParsedInvocation): Promise<number> {
  if (invocation.positionals.length > 1) {
    throw new CliUsageError(`Unexpected argument: ${invocation.positionals[1]}`);
  }
  const { findSkill, loadExtensions, loadSkillDocument, skillCatalog } =
    await loadExtensionsModule();
  const snapshot = loadExtensions();
  const name = invocation.positionals[0];

  if (name === undefined) {
    const entries = skillCatalog(snapshot.skills);
    if (invocation.json) {
      printSuccess(invocation.json, {
        skills: entries,
        diagnostics: snapshot.diagnostics,
      }, "");
    } else if (entries.length === 0) {
      writeLine(
        "No skills installed. Add skills under ~/.agents/skills, or set TIDESURF_EXTENSIONS=all to trust project skills."
      );
    } else {
      writeLine(
        entries
          .map((entry) =>
            `${entry.name}\t${entry.source}${entry.plugin ? ` (${entry.plugin})` : ""}\t${entry.description}`
          )
          .join("\n")
      );
    }
    if (!invocation.json) {
      for (const diagnostic of snapshot.diagnostics) {
        writeLine(`warning: ${diagnostic}`, process.stderr);
      }
    }
    return 0;
  }

  const skill = findSkill(snapshot, name);
  if (!skill) {
    const available = snapshot.skills.map((entry) => entry.name);
    throw new CliUsageError(
      available.length > 0
        ? `Unknown skill: ${name}. Available skills: ${available.join(", ")}.`
        : `Unknown skill: ${name}. No skills are installed.`
    );
  }
  const document = loadSkillDocument(skill);
  if (invocation.json) {
    printSuccess(true, {
      name: skill.name,
      description: skill.description,
      ...(skill.plugin ? { plugin: skill.plugin } : {}),
      source: skill.source,
      directory: skill.directory,
      ...(skill.license === undefined ? {} : { license: skill.license }),
      ...(skill.compatibility === undefined
        ? {}
        : { compatibility: skill.compatibility }),
      ...(skill.metadata === undefined ? {} : { metadata: skill.metadata }),
      ...(skill.allowedTools === undefined
        ? {}
        : { allowedTools: skill.allowedTools }),
      files: document.files,
      content: document.raw,
      body: document.body,
    }, "");
  } else {
    process.stdout.write(document.raw);
    if (document.files.length > 0) {
      writeLine(`\nBundled files:\n${document.files.map((file) => `  ${file}`).join("\n")}`);
    }
  }
  return 0;
}

async function listPlugins(invocation: ParsedInvocation): Promise<number> {
  if (invocation.positionals.length) {
    throw new CliUsageError("plugins takes no arguments");
  }
  const { loadExtensions } = await loadExtensionsModule();
  const snapshot = loadExtensions();
  const summaries = snapshot.plugins.map((plugin) => ({
    name: plugin.name,
    ...(plugin.manifest.version ? { version: plugin.manifest.version } : {}),
    ...(plugin.manifest.description
      ? { description: plugin.manifest.description }
      : {}),
    source: plugin.source,
    directory: plugin.directory,
    skills: plugin.skills.map((skill) => skill.name),
    mcpServers: plugin.mcpServers.map((server) => ({
      name: server.name,
      type: server.type,
    })),
    ...(plugin.mcpDisabled ? { mcpDisabled: plugin.mcpDisabled } : {}),
    diagnostics: plugin.diagnostics.map((entry) => entry.message),
  }));
  if (invocation.json) {
    printSuccess(true, {
      plugins: summaries,
      diagnostics: snapshot.diagnostics,
    }, "");
    return 0;
  }
  if (summaries.length === 0) {
    writeLine(
      "No plugins installed. Add plugins under ~/.tidesurf/plugins, or set TIDESURF_EXTENSIONS=all to trust project plugins."
    );
    for (const diagnostic of snapshot.diagnostics) {
      writeLine(`warning: ${diagnostic}`, process.stderr);
    }
    return 0;
  }
  const lines: string[] = [];
  for (const [index, plugin] of summaries.entries()) {
    const pluginDiagnostics = snapshot.plugins[index].diagnostics;
    lines.push(
      `${plugin.name}${plugin.version ? `@${plugin.version}` : ""}\t${plugin.source}\t${plugin.directory}`
    );
    lines.push(
      `  skills: ${plugin.skills.length > 0 ? plugin.skills.join(", ") : "none"}`
    );
    lines.push(
      `  mcp servers: ${
        plugin.mcpServers.length > 0
          ? plugin.mcpServers.map((server) => `${server.name} (${server.type})`).join(", ")
          : "none"
      }${plugin.mcpDisabled ? ` [disabled: ${plugin.mcpDisabled}]` : ""}`
    );
    for (const entry of pluginDiagnostics) {
      lines.push(`  warning: ${entry.message}`);
    }
  }
  for (const diagnostic of snapshot.diagnostics) {
    if (!diagnostic.includes(": duplicate plugin in ")) {
      lines.push(`warning: ${diagnostic}`);
    }
  }
  writeLine(lines.join("\n"));
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
    return printToolResult(
      await controller.inspect(url, input as ReadPageOptions),
      invocation.json
    );
  } finally {
    await controller.close();
  }
}

const MCP_INSTRUCTIONS_MAX_SKILLS = 30;
const MCP_INSTRUCTIONS_MAX_LINE = 200;
const MCP_INSTRUCTIONS_MAX_TOTAL = 4_000;

function buildMcpInstructions(
  entries: readonly { name: string; description: string }[]
): string | undefined {
  if (entries.length === 0) return undefined;
  const lines: string[] = [];
  let total = 0;
  for (const entry of entries.slice(0, MCP_INSTRUCTIONS_MAX_SKILLS)) {
    const description = entry.description.length > MCP_INSTRUCTIONS_MAX_LINE
      ? `${entry.description.slice(0, MCP_INSTRUCTIONS_MAX_LINE - 1)}…`
      : entry.description;
    const line = `- ${entry.name}: ${description}`;
    if (total + line.length > MCP_INSTRUCTIONS_MAX_TOTAL) break;
    lines.push(line);
    total += line.length;
  }
  if (lines.length === 0) return undefined;
  return [
    "Agent Skills are installed for this session. Call list_skills to enumerate them with sources, then read_skill to load a skill document before following it.",
    "",
    ...lines,
  ].join("\n");
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
  type McpRuntimeTransport = {
    start(): Promise<void>;
    send(message: unknown, options?: unknown): Promise<void>;
    close(): Promise<void>;
    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: (message: unknown, extra?: unknown) => void;
  };
  let externalModules: [
    { McpServer: new (info: { name: string; version: string }, options?: { instructions?: string }) => McpRuntimeServer },
    { StdioServerTransport: new () => McpRuntimeTransport },
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
    { loadExtensions, skillCatalog },
  ] = await Promise.all([
    import("./mcp/adapter.js"),
    import("./cli/browser-controller.js"),
    import("./extensions/index.js"),
  ]);
  const extensions = loadExtensions();
  const instructions = buildMcpInstructions(skillCatalog(extensions.skills));
  const server = new McpServer(
    { name: "tidesurf", version: VERSION },
    instructions ? { instructions } : undefined
  );
  const controller = new BrowserController(invocation.sessionConfig);
  const inputSchemaFactory = createZodInputSchemaFactory(z);
  registerMcpTools({
    server,
    coordinator: controller,
    createInputSchema: inputSchemaFactory,
    readOnly: invocation.sessionConfig.readOnly,
  });

  const log = invocation.quiet
    ? () => undefined
    : (value: string) => writeLine(`[tidesurf] ${value}`, process.stderr);
  for (const diagnostic of extensions.diagnostics) {
    log(`extensions: ${diagnostic}`);
  }

  const pluginStartupAbort = new AbortController();
  type ClosablePluginProxy = { close(): Promise<void> };
  let pluginProxy: ClosablePluginProxy | undefined;
  let pluginStartupPromise: Promise<ClosablePluginProxy> | undefined;
  let closingPromise: Promise<void> | null = null;
  const close = (): Promise<void> => {
    if (closingPromise !== null) return closingPromise;
    pluginStartupAbort.abort(new Error("MCP server is shutting down"));
    closingPromise = Promise.allSettled([
      Promise.resolve().then(() => controller.close()),
      Promise.resolve().then(() => server.close()),
      Promise.resolve().then(async () => {
        const proxy = pluginProxy ?? await pluginStartupPromise;
        await proxy?.close();
      }),
    ]).then((results) => {
      for (const result of results) {
        if (result.status === "rejected") {
          log(`MCP cleanup failed: ${message(result.reason)}`);
        }
      }
    });
    return closingPromise;
  };
  // A wedged in-flight tool can keep close() pending forever; SIGINT,
  // SIGTERM, and stdin EOF must still terminate the process, so every exit
  // path races the all-settled cleanup against a bounded grace period.
  const closeWithGrace = (): Promise<void> => {
    let graceTimer!: ReturnType<typeof setTimeout>;
    return Promise.race([
      close(),
      new Promise<void>((resolveGrace) => {
        graceTimer = setTimeout(resolveGrace, MCP_CLOSE_GRACE_MS);
      }),
    ]).finally(() => clearTimeout(graceTimer));
  };
  const shutdown = (code: number) => {
    void closeWithGrace()
      .catch(printError)
      .finally(() => process.exit(code));
  };
  let inputEnded = false;
  const closeOnInputEnd = () => {
    if (inputEnded) return;
    inputEnded = true;
    void closeWithGrace()
      .catch((error) => {
        printError(error);
        process.exitCode = CLI_EXIT_CODES.protocol.code;
      })
      .finally(() => process.exit(process.exitCode ?? 0));
  };

  // These handlers must exist before any untrusted plugin process is started.
  process.once("SIGINT", () => shutdown(130));
  process.once("SIGTERM", () => shutdown(143));
  process.stdin.once("end", closeOnInputEnd);
  process.stdin.once("close", closeOnInputEnd);

  // Start reading stdio now so EOF is observable during plugin startup, but
  // hold protocol messages until registration is complete. This keeps the
  // first tools/list deterministic without sacrificing early shutdown.
  const rawTransport = new StdioServerTransport();
  const queuedMessages: Array<{ message: unknown; extra?: unknown }> = [];
  let queuedMessageBytes = 0;
  let releasedMessages = false;
  let hostQueueError: Error | undefined;
  let signalHostQueueFailure!: () => void;
  const hostQueueFailure = new Promise<void>((resolveFailure) => {
    signalHostQueueFailure = resolveFailure;
  });
  const failHostQueue = (error: Error): void => {
    if (hostQueueError !== undefined) return;
    hostQueueError = error;
    queuedMessages.length = 0;
    queuedMessageBytes = 0;
    pluginStartupAbort.abort(error);
    signalHostQueueFailure();
  };
  const enqueueHostMessage = (received: unknown, extra?: unknown): void => {
    let encoded: string | undefined;
    try {
      encoded = JSON.stringify(received);
    } catch (error) {
      failHostQueue(
        new Error(`MCP startup message is not serializable: ${message(error)}`)
      );
      return;
    }
    if (encoded === undefined) {
      failHostQueue(new Error("MCP startup message is not serializable"));
      return;
    }
    const bytes = Buffer.byteLength(encoded);
    if (
      queuedMessages.length >= MCP_STARTUP_QUEUE_MAX_MESSAGES ||
      bytes > MCP_STARTUP_QUEUE_MAX_BYTES - queuedMessageBytes
    ) {
      failHostQueue(
        new Error(
          `MCP startup message queue exceeded ${MCP_STARTUP_QUEUE_MAX_MESSAGES} messages or ${MCP_STARTUP_QUEUE_MAX_BYTES} serialized bytes`
        )
      );
      return;
    }
    queuedMessages.push({ message: received, extra });
    queuedMessageBytes += bytes;
  };
  const waitForHostQueue = async <T>(pending: Promise<T>): Promise<T> => {
    const outcome = await Promise.race([
      pending.then((value) => ({ failed: false as const, value })),
      hostQueueFailure.then(() => ({ failed: true as const })),
    ]);
    if (outcome.failed) throw hostQueueError!;
    return outcome.value;
  };
  const hostTransport: McpRuntimeTransport = {
    start: async () => {
      rawTransport.onclose = () => hostTransport.onclose?.();
      rawTransport.onerror = (error) => hostTransport.onerror?.(error);
      rawTransport.onmessage = (received, extra) => {
        if (releasedMessages) hostTransport.onmessage?.(received, extra);
        else enqueueHostMessage(received, extra);
      };
      await rawTransport.start();
    },
    send: (value, sendOptions) => rawTransport.send(value, sendOptions),
    close: async () => {
      queuedMessages.length = 0;
      queuedMessageBytes = 0;
      await rawTransport.close();
    },
  };
  const releaseHostMessages = (): void => {
    if (releasedMessages) return;
    releasedMessages = true;
    const pending = queuedMessages.splice(0);
    queuedMessageBytes = 0;
    for (const entry of pending) {
      hostTransport.onmessage?.(entry.message, entry.extra);
    }
  };

  const hasPluginServers = extensions.plugins.some(
    (plugin) => plugin.mcpServers.length > 0
  );
  const nestedPluginChild = process.env["TIDESURF_PLUGIN_MCP_CHILD"] === "1";
  const proxyPlugins =
    hasPluginServers &&
    !invocation.sessionConfig.readOnly &&
    !nestedPluginChild;
  try {
    await waitForHostQueue(server.connect(hostTransport));

    if (proxyPlugins) {
      const clientModules = await waitForHostQueue(Promise.all([
        import("@modelcontextprotocol/sdk/client/index.js").catch(() => undefined),
        import("@modelcontextprotocol/sdk/client/stdio.js").catch(() => undefined),
        import("@modelcontextprotocol/sdk/client/streamableHttp.js").catch(() => undefined),
      ]));
      const [clientModule, stdioModule, httpModule] = clientModules;
      if (!clientModule || !stdioModule || !httpModule) {
        log("plugin MCP servers disabled: MCP SDK client modules are unavailable");
      } else {
        const { proxyPluginMcpServers } = await import("./mcp/plugin-proxy.js");
        pluginStartupPromise = proxyPluginMcpServers({
          server,
          plugins: extensions.plugins,
          log,
          signal: pluginStartupAbort.signal,
          factories: {
            createClient: () => {
              const client = new clientModule.Client({
                name: "tidesurf",
                version: VERSION,
              });
              return {
                connect: (transport, requestOptions) =>
                  client.connect(
                    transport as Parameters<typeof client.connect>[0],
                    requestOptions
                  ),
                listTools: (params, requestOptions) =>
                  client.listTools(params, requestOptions),
                callTool: (params, _resultSchema, requestOptions) =>
                  client.callTool(params, undefined, requestOptions),
                close: () => client.close(),
              };
            },
            createStdioTransport: (params) =>
              new stdioModule.StdioClientTransport({
                ...params,
                args: [...params.args],
              }),
            createHttpTransport: (params) =>
              new httpModule.StreamableHTTPClientTransport(new URL(params.url), {
                requestInit: params.headers ? { headers: params.headers } : undefined,
                fetch: params.fetch,
              }),
            createInputSchema: (schema) =>
              inputSchemaFactory(
                schema as Parameters<typeof inputSchemaFactory>[0]
              ),
          },
        });
        const startedProxy = await waitForHostQueue(pluginStartupPromise);
        pluginProxy = startedProxy;
        if (closingPromise !== null) await startedProxy.close();
      }
    } else if (hasPluginServers && invocation.sessionConfig.readOnly) {
      log("plugin MCP servers disabled in read-only mode");
    } else if (hasPluginServers && nestedPluginChild) {
      log("plugin MCP servers disabled in nested plugin MCP child");
    }
    releaseHostMessages();
  } catch (error) {
    await closeWithGrace();
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
  skills: listSkills,
  plugins: listPlugins,
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
