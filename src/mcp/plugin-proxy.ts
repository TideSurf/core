import { createHash } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync } from "node:fs";
import type {
  LoadedPlugin,
  PluginMcpServer,
} from "../extensions/plugins.js";
import type {
  McpCallResult,
  McpRequestHandlerExtra,
  McpServerLike,
  McpToolRegistration,
} from "./adapter.js";

interface RemoteTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: unknown;
  readonly execution?: {
    readonly taskSupport?: "optional" | "required" | "forbidden";
  };
}

export interface McpRequestOptionsLike {
  readonly signal?: AbortSignal;
  readonly timeout?: number;
  readonly resetTimeoutOnProgress?: boolean;
  readonly maxTotalTimeout?: number;
}

export interface McpClientLike {
  connect(
    transport: unknown,
    options?: McpRequestOptionsLike
  ): Promise<void>;
  listTools(
    params?: { readonly cursor?: string },
    options?: McpRequestOptionsLike
  ): Promise<{ tools: RemoteTool[]; nextCursor?: string }>;
  callTool(
    params: {
      name: string;
      arguments?: Record<string, unknown>;
    },
    resultSchema: undefined,
    options?: McpRequestOptionsLike
  ): Promise<unknown>;
  close(): Promise<void>;
}

export type PluginHttpFetch = (
  url: string | URL,
  init?: RequestInit
) => Promise<Response>;

export interface PluginProxyFactories {
  readonly createClient: () => McpClientLike;
  readonly createStdioTransport: (params: {
    command: string;
    args: readonly string[];
    env: Record<string, string>;
    cwd: string;
    stderr: "inherit" | "pipe";
  }) => unknown;
  readonly createHttpTransport: (params: {
    url: string;
    headers?: Record<string, string>;
    fetch: PluginHttpFetch;
  }) => unknown;
  readonly createInputSchema: (schema: unknown) => unknown;
}

interface PluginProxyTimeouts {
  readonly startupMs?: number;
  readonly callMs?: number;
  readonly closeGraceMs?: number;
}

export interface PluginProxyOptions {
  readonly server: McpServerLike;
  readonly plugins: readonly LoadedPlugin[];
  readonly factories: PluginProxyFactories;
  readonly log?: (message: string) => void;
  readonly signal?: AbortSignal;
  /** Smaller values are accepted for deterministic tests; production maxima cannot be raised. */
  readonly timeouts?: PluginProxyTimeouts;
}

export interface ProxiedServerInfo {
  readonly plugin: string;
  readonly server: string;
  readonly tools: number;
}

export interface PluginProxy {
  readonly servers: readonly ProxiedServerInfo[];
  close(): Promise<void>;
}

const MAX_SERVERS = 32;
const STARTUP_CONCURRENCY = 4;
const STARTUP_TIMEOUT_MS = 10_000;
const MAX_TOOLS_PER_SERVER = 128;
const MAX_TOOLS_TOTAL = 256;
const MAX_LIST_PAGES = 100;
const MAX_CURSOR_BYTES = 4 * 1024;
const MAX_REMOTE_TOOL_NAME_BYTES = 256;
const MAX_TOOL_DESCRIPTION_BYTES = 16 * 1024;
const MAX_LIST_RETAINED_BYTES = 4 * 1024 * 1024;
const MAX_SCHEMA_BYTES = 256 * 1024;
const MAX_SCHEMA_DEPTH = 64;
const MAX_TOOL_CALL_MS = 30_000;
const MAX_RESULT_BYTES = 16 * 1024 * 1024;
const MAX_TOOL_NAME_BYTES = 64;
const TOOL_NAME_HASH_BYTES = 12;
const CLOSE_GRACE_MS = 5_000;

const POSIX_INHERITED_ENV = [
  "HOME",
  "LOGNAME",
  "PATH",
  "SHELL",
  "TERM",
  "USER",
] as const;
const WINDOWS_INHERITED_ENV = [
  "APPDATA",
  "HOMEDRIVE",
  "HOMEPATH",
  "LOCALAPPDATA",
  "PATH",
  "PROCESSOR_ARCHITECTURE",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "TEMP",
  "USERNAME",
  "USERPROFILE",
  "PROGRAMFILES",
] as const;

function boundedTimeout(value: number | undefined, maximum: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return maximum;
  return Math.min(Math.floor(value), maximum);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Reject redirects and any SDK request that escapes the configured origin. */
export function createControlledPluginHttpFetch(
  endpoint: string | URL,
  fetchImplementation: PluginHttpFetch = (url, init) => fetch(url, init)
): PluginHttpFetch {
  const expected = new URL(endpoint);
  return async (url, init) => {
    const target = new URL(typeof url === "string" ? url : url.href);
    if (target.origin !== expected.origin) {
      throw new Error(
        `plugin MCP HTTP request origin ${target.origin} differs from configured origin ${expected.origin}`
      );
    }
    const response = await fetchImplementation(target, {
      ...init,
      redirect: "manual",
    });
    if (
      (response.status >= 300 && response.status < 400) ||
      response.type === "opaqueredirect" ||
      response.redirected
    ) {
      try {
        await response.body?.cancel();
      } catch {
        // The redirect is rejected regardless of body cancellation support.
      }
      throw new Error(`plugin MCP HTTP redirect rejected for ${target.href}`);
    }
    return response;
  };
}

function abortError(reason: unknown, fallback: string): Error {
  if (reason instanceof Error) return reason;
  const error = new Error(reason === undefined ? fallback : String(reason));
  error.name = "AbortError";
  return error;
}

function environmentLookup(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  caseInsensitive: boolean
): string | undefined {
  if (!caseInsensitive) return env[name];
  const folded = name.toUpperCase();
  for (const [key, value] of Object.entries(env)) {
    if (key.toUpperCase() === folded) return value;
  }
  return undefined;
}

function setEnvironmentValue(
  env: Record<string, string>,
  canonicalNames: Map<string, string>,
  name: string,
  value: string,
  caseInsensitive: boolean,
  forceCanonical = false
): void {
  if (!caseInsensitive) {
    env[name] = value;
    return;
  }
  const folded = name.toUpperCase();
  const existing = canonicalNames.get(folded);
  if (forceCanonical) {
    if (existing !== undefined && existing !== name) delete env[existing];
    canonicalNames.set(folded, name);
    env[name] = value;
    return;
  }
  const target = existing ?? name;
  canonicalNames.set(folded, target);
  env[target] = value;
}

/** Build the SDK-equivalent safe stdio environment plus explicit plugin values. */
export function buildPluginStdioEnvironment(params: {
  readonly configured?: Readonly<Record<string, string>>;
  readonly pluginRoot: string;
  readonly pluginData: string;
  readonly inherited?: Readonly<Record<string, string | undefined>>;
  readonly platform?: NodeJS.Platform;
}): Record<string, string> {
  const platform = params.platform ?? process.platform;
  const inherited = params.inherited ?? process.env;
  const caseInsensitive = platform === "win32";
  const allowlist = caseInsensitive
    ? WINDOWS_INHERITED_ENV
    : POSIX_INHERITED_ENV;
  const result: Record<string, string> = {};
  const canonicalNames = new Map<string, string>();

  for (const name of allowlist) {
    const value = environmentLookup(inherited, name, caseInsensitive);
    if (value === undefined || value.startsWith("()")) continue;
    setEnvironmentValue(
      result,
      canonicalNames,
      name,
      value,
      caseInsensitive
    );
  }
  for (const [name, value] of Object.entries(params.configured ?? {})) {
    setEnvironmentValue(
      result,
      canonicalNames,
      name,
      value,
      caseInsensitive
    );
  }

  for (const [name, value] of [
    ["PLUGIN_ROOT", params.pluginRoot],
    ["PLUGIN_DATA", params.pluginData],
    ["TIDESURF_PLUGIN_MCP_CHILD", "1"],
  ] as const) {
    setEnvironmentValue(
      result,
      canonicalNames,
      name,
      value,
      caseInsensitive,
      true
    );
  }
  return result;
}

function ensurePluginDataDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stats = lstatSync(path);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error("plugin data path must be a directory, not a symbolic link");
  }
  chmodSync(path, 0o700);
}

function requestOptions(
  signal: AbortSignal,
  deadline: number
): McpRequestOptionsLike {
  const remaining = Math.max(1, deadline - Date.now());
  return {
    signal,
    timeout: remaining,
    resetTimeoutOnProgress: false,
    maxTotalTimeout: remaining,
  };
}

async function withSharedDeadline<T>(
  signal: AbortSignal,
  deadline: number,
  operation: (signal: AbortSignal, deadline: number) => Promise<T>
): Promise<T> {
  if (signal.aborted) {
    throw abortError(signal.reason, "plugin proxy startup cancelled");
  }
  let onAbort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () =>
      reject(abortError(signal.reason, "plugin proxy startup cancelled"));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  const pending = Promise.resolve().then(() => operation(signal, deadline));
  try {
    return await Promise.race([pending, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

interface CleanupOperation {
  readonly label: string;
  readonly run: () => void | Promise<void>;
  readonly onSuccess?: () => void;
}

class CleanupRegistry {
  private readonly operations = new Set<CleanupOperation>();

  constructor(private readonly log: (message: string) => void) {}

  retain(
    label: string,
    run: () => void | Promise<void>,
    onSuccess?: () => void
  ): CleanupOperation {
    const operation: CleanupOperation = { label, run, onSuccess };
    this.operations.add(operation);
    return operation;
  }

  async attempt(
    requested: readonly CleanupOperation[],
    graceMs: number,
    context: string
  ): Promise<void> {
    const operations = [...new Set(requested)].filter((operation) =>
      this.operations.has(operation)
    );
    if (operations.length === 0) return;
    const settled = Promise.all(
      operations.map(async (operation) => {
        try {
          await operation.run();
          if (this.operations.delete(operation)) {
            try {
              operation.onSuccess?.();
            } catch (error) {
              this.log(
                `${context} completion bookkeeping failed (${operation.label}): ${errorMessage(error)}`
              );
            }
          }
        } catch (error) {
          if (this.operations.has(operation)) {
            this.log(
              `${context} operation failed (${operation.label}): ${errorMessage(error)}`
            );
          }
        }
      })
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = await Promise.race([
      settled.then(() => false),
      new Promise<boolean>((resolveTimeout) => {
        timer = setTimeout(() => resolveTimeout(true), graceMs);
      }),
    ]);
    if (timer !== undefined) clearTimeout(timer);
    if (timedOut) this.log(`${context} exceeded ${graceMs}ms grace`);
  }

  attemptAll(graceMs: number, context: string): Promise<void> {
    return this.attempt([...this.operations], graceMs, context);
  }

  has(operation: CleanupOperation): boolean {
    return this.operations.has(operation);
  }
}

function createPluginProxyResult(
  servers: readonly ProxiedServerInfo[],
  cleanup: CleanupRegistry,
  closeGraceMs: number
): PluginProxy {
  let closeAttempt: Promise<void> | undefined;
  return {
    servers,
    close: () => {
      if (closeAttempt !== undefined) return closeAttempt;
      let tracked!: Promise<void>;
      tracked = cleanup.attemptAll(closeGraceMs, "plugin proxy close").then(
        () => {
          if (closeAttempt === tracked) closeAttempt = undefined;
        },
        (error) => {
          if (closeAttempt === tracked) closeAttempt = undefined;
          throw error;
        }
      );
      closeAttempt = tracked;
      return tracked;
    },
  };
}

function assertSchemaWithinLimits(schema: unknown): void {
  const seen = new WeakSet<object>();
  const stack: Array<{ value: unknown; depth: number }> = [
    { value: schema, depth: 1 },
  ];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.depth > MAX_SCHEMA_DEPTH) {
      throw new Error(`input schema exceeds depth limit ${MAX_SCHEMA_DEPTH}`);
    }
    if (typeof current.value !== "object" || current.value === null) continue;
    if (seen.has(current.value)) throw new Error("input schema is cyclic");
    seen.add(current.value);
    for (const child of Object.values(current.value)) {
      stack.push({ value: child, depth: current.depth + 1 });
    }
  }

  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(schema);
  } catch (error) {
    throw new Error(`input schema is not serializable: ${errorMessage(error)}`);
  }
  if (encoded === undefined) throw new Error("input schema is not serializable");
  const bytes = Buffer.byteLength(encoded);
  if (bytes > MAX_SCHEMA_BYTES) {
    throw new Error(`input schema exceeds ${MAX_SCHEMA_BYTES}-byte limit`);
  }
}

function checkedCallResult(result: unknown): McpCallResult {
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(result);
  } catch (error) {
    throw new Error(`plugin result is not serializable: ${errorMessage(error)}`);
  }
  if (encoded === undefined) throw new Error("plugin result is not serializable");
  if (Buffer.byteLength(encoded) > MAX_RESULT_BYTES) {
    throw new Error(`plugin result exceeds ${MAX_RESULT_BYTES}-byte limit`);
  }
  return result as McpCallResult;
}

function sanitizeToolComponent(value: string, fallback: string): string {
  const sanitized = value.replaceAll(/[^a-zA-Z0-9_-]/g, "-");
  return sanitized === "" ? fallback : sanitized;
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, TOOL_NAME_HASH_BYTES);
}

function toolNamespace(
  plugin: LoadedPlugin,
  serverName: string,
  tool: RemoteTool,
  toolIndex: number,
  takenNames: ReadonlySet<string>
): string {
  const raw = `${plugin.name}__${tool.name}`;
  const validRaw = /^[a-zA-Z0-9_-]+$/.test(raw);
  if (
    validRaw &&
    Buffer.byteLength(raw) <= MAX_TOOL_NAME_BYTES &&
    !takenNames.has(raw)
  ) {
    return raw;
  }

  const base = `${sanitizeToolComponent(plugin.name, "plugin")}__${sanitizeToolComponent(tool.name, "tool")}`;
  const identity = `${plugin.name}\0${serverName}\0${tool.name}\0${toolIndex}`;
  for (let attempt = 0; ; attempt++) {
    const suffix = `-${shortHash(`${identity}\0${attempt}`)}`;
    const prefixBytes = MAX_TOOL_NAME_BYTES - suffix.length;
    const prefix = base.slice(0, prefixBytes);
    const candidate = `${prefix}${suffix}`;
    if (!takenNames.has(candidate)) return candidate;
  }
}

async function callWithBounds(
  client: McpClientLike,
  remoteName: string,
  input: Record<string, unknown>,
  extra: McpRequestHandlerExtra | undefined,
  timeoutMs: number
): Promise<McpCallResult> {
  const signal = extra?.signal ?? new AbortController().signal;
  const options: McpRequestOptionsLike = {
    signal,
    timeout: timeoutMs,
    resetTimeoutOnProgress: false,
    maxTotalTimeout: timeoutMs,
  };
  const pending = Promise.resolve().then(() =>
    client.callTool(
      { name: remoteName, arguments: input },
      undefined,
      options
    )
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`plugin tool call timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
  });
  let onAbort: (() => void) | undefined;
  const aborted = signal.aborted
    ? Promise.reject<never>(abortError(signal.reason, "plugin tool call cancelled"))
    : new Promise<never>((_resolve, reject) => {
        onAbort = () =>
          reject(abortError(signal.reason, "plugin tool call cancelled"));
        signal.addEventListener("abort", onAbort, { once: true });
      });
  try {
    return checkedCallResult(await Promise.race([pending, timedOut, aborted]));
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort !== undefined) signal.removeEventListener("abort", onAbort);
  }
}

interface ServerEntry {
  readonly plugin: LoadedPlugin;
  readonly spec: PluginMcpServer;
}

interface ConnectedServer {
  readonly entry: ServerEntry;
  readonly client: McpClientLike;
  readonly clientCleanup: CleanupOperation;
  readonly tools: readonly RemoteTool[];
  readonly toolsCapReason?: string;
}

interface ListedTools {
  readonly tools: RemoteTool[];
  readonly capReason?: string;
}

function serializedToolBytes(tool: RemoteTool): number {
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(tool);
  } catch (error) {
    throw new Error(`tools/list tool is not serializable: ${errorMessage(error)}`);
  }
  if (encoded === undefined) throw new Error("tools/list tool is not serializable");
  return Buffer.byteLength(encoded);
}

function validateRemoteToolMetadata(tool: RemoteTool): void {
  if (typeof tool?.name !== "string" || tool.name.length === 0) {
    throw new Error("tools/list tool name must be a non-empty string");
  }
  if (Buffer.byteLength(tool.name) > MAX_REMOTE_TOOL_NAME_BYTES) {
    throw new Error(
      `tools/list tool name exceeds ${MAX_REMOTE_TOOL_NAME_BYTES}-byte limit`
    );
  }
  if (tool.description !== undefined) {
    if (typeof tool.description !== "string") {
      throw new Error("tools/list tool description must be a string");
    }
    if (Buffer.byteLength(tool.description) > MAX_TOOL_DESCRIPTION_BYTES) {
      throw new Error(
        `tools/list tool description exceeds ${MAX_TOOL_DESCRIPTION_BYTES}-byte limit`
      );
    }
  }
}

async function listRemoteTools(
  client: McpClientLike,
  signal: AbortSignal,
  deadline: number
): Promise<ListedTools> {
  const tools: RemoteTool[] = [];
  const seenCursors = new Set<string>();
  let retainedBytes = 0;
  let cursor: string | undefined;

  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const response = await client.listTools(
      cursor === undefined ? {} : { cursor },
      requestOptions(signal, deadline)
    );
    if (!Array.isArray(response.tools)) {
      throw new Error("tools/list returned an invalid tools array");
    }
    for (let index = 0; index < response.tools.length; index++) {
      if (tools.length === MAX_TOOLS_PER_SERVER) {
        return {
          tools,
          capReason: `tool count limit ${MAX_TOOLS_PER_SERVER}`,
        };
      }
      const tool = response.tools[index];
      validateRemoteToolMetadata(tool);
      const bytes = serializedToolBytes(tool);
      if (bytes > MAX_LIST_RETAINED_BYTES - retainedBytes) {
        return {
          tools,
          capReason: `aggregate retained data limit ${MAX_LIST_RETAINED_BYTES} bytes`,
        };
      }
      tools.push(tool);
      retainedBytes += bytes;
    }
    if (tools.length === MAX_TOOLS_PER_SERVER) {
      return response.nextCursor === undefined
        ? { tools }
        : {
            tools,
            capReason: `tool count limit ${MAX_TOOLS_PER_SERVER}`,
          };
    }

    const next = response.nextCursor;
    if (next === undefined) return { tools };
    if (typeof next !== "string") {
      throw new Error("tools/list cursor must be a string");
    }
    const cursorBytes = Buffer.byteLength(next);
    if (cursorBytes > MAX_CURSOR_BYTES) {
      throw new Error(
        `tools/list cursor exceeds ${MAX_CURSOR_BYTES}-byte limit`
      );
    }
    if (seenCursors.has(next)) {
      throw new Error(`tools/list repeated cursor ${JSON.stringify(next)}`);
    }
    if (cursorBytes > MAX_LIST_RETAINED_BYTES - retainedBytes) {
      return {
        tools,
        capReason: `aggregate retained data limit ${MAX_LIST_RETAINED_BYTES} bytes`,
      };
    }
    seenCursors.add(next);
    retainedBytes += cursorBytes;
    cursor = next;
  }
  throw new Error(`tools/list exceeded ${MAX_LIST_PAGES} pages`);
}

async function connectServer(
  entry: ServerEntry,
  factories: PluginProxyFactories,
  cleanup: CleanupRegistry,
  startupSignal: AbortSignal,
  startupDeadline: number,
  closeGraceMs: number,
  log: (message: string) => void
): Promise<ConnectedServer | undefined> {
  const label = `plugin "${entry.plugin.name}" server "${entry.spec.name}"`;
  let client: McpClientLike | undefined;
  let clientCleanup: CleanupOperation | undefined;
  try {
    return await withSharedDeadline(
      startupSignal,
      startupDeadline,
      async (signal, deadline) => {
        if (signal.aborted) {
          throw abortError(signal.reason, "plugin proxy startup cancelled");
        }
        client = factories.createClient();
        const createdClient = client;
        clientCleanup = cleanup.retain(
          `${label} client close`,
          () => createdClient.close()
        );
        const { plugin, spec } = entry;
        let transport: unknown;
        if (spec.type === "stdio") {
          ensurePluginDataDirectory(plugin.dataDirectory);
          transport = factories.createStdioTransport({
            command: spec.command!,
            args: spec.args ?? [],
            env: buildPluginStdioEnvironment({
              configured: spec.env,
              pluginRoot: plugin.directory,
              pluginData: plugin.dataDirectory,
            }),
            cwd: spec.cwd ?? plugin.directory,
            stderr: "inherit",
          });
        } else {
          transport = factories.createHttpTransport({
            url: spec.url!,
            ...(spec.headers ? { headers: { ...spec.headers } } : {}),
            fetch: createControlledPluginHttpFetch(spec.url!),
          });
        }
        await client.connect(transport, requestOptions(signal, deadline));
        const listed = await listRemoteTools(client, signal, deadline);
        return {
          entry,
          client,
          clientCleanup: clientCleanup!,
          tools: listed.tools,
          ...(listed.capReason === undefined
            ? {}
            : { toolsCapReason: listed.capReason }),
        };
      }
    );
  } catch (error) {
    if (clientCleanup !== undefined) {
      await cleanup.attempt(
        [clientCleanup],
        closeGraceMs,
        `${label}: startup cleanup`
      );
    }
    log(`${label} failed to start: ${errorMessage(error)}`);
    return undefined;
  }
}

interface ActiveRegistration {
  readonly name: string;
  readonly cleanup: CleanupOperation;
}

/**
 * Connect plugin MCP servers under strict resource bounds and mirror their
 * tools into TideSurf's server. Startup is concurrent, while registration is
 * replayed in manifest order so tools/list remains deterministic.
 */
export async function proxyPluginMcpServers(
  options: PluginProxyOptions
): Promise<PluginProxy> {
  const log = options.log ?? (() => undefined);
  const startupMs = boundedTimeout(options.timeouts?.startupMs, STARTUP_TIMEOUT_MS);
  const callMs = boundedTimeout(options.timeouts?.callMs, MAX_TOOL_CALL_MS);
  const closeGraceMs = boundedTimeout(
    options.timeouts?.closeGraceMs,
    CLOSE_GRACE_MS
  );
  const cleanup = new CleanupRegistry(log);
  const declarations: ServerEntry[] = [];
  for (const plugin of options.plugins) {
    for (const spec of plugin.mcpServers) declarations.push({ plugin, spec });
  }
  if (declarations.length > MAX_SERVERS) {
    log(
      `plugin MCP server limit reached: only the first ${MAX_SERVERS} of ${declarations.length} servers are started`
    );
  }
  const selected = declarations.slice(0, MAX_SERVERS);
  const connected: Array<ConnectedServer | undefined> = new Array(selected.length);
  const startupController = new AbortController();
  const startupDeadline = Date.now() + startupMs;
  const startupTimeoutError = new Error(`startup timed out after ${startupMs}ms`);
  const expireStartup = (): void => {
    if (!startupController.signal.aborted) {
      startupController.abort(startupTimeoutError);
    }
  };
  const onParentAbort = (): void => {
    startupController.abort(
      abortError(options.signal?.reason, "plugin proxy startup cancelled")
    );
  };
  if (options.signal?.aborted) onParentAbort();
  else options.signal?.addEventListener("abort", onParentAbort, { once: true });
  const startupTimer = setTimeout(expireStartup, startupMs);
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      if (startupController.signal.aborted) return;
      if (Date.now() >= startupDeadline) {
        expireStartup();
        return;
      }
      const index = nextIndex++;
      if (index >= selected.length) return;
      connected[index] = await connectServer(
        selected[index],
        options.factories,
        cleanup,
        startupController.signal,
        startupDeadline,
        closeGraceMs,
        log
      );
    }
  };
  try {
    await Promise.allSettled(
      Array.from(
        { length: Math.min(STARTUP_CONCURRENCY, selected.length) },
        () => worker()
      )
    );
  } finally {
    clearTimeout(startupTimer);
    options.signal?.removeEventListener("abort", onParentAbort);
  }

  if (options.signal?.aborted) {
    const cleanups = connected.flatMap((entry) =>
      entry === undefined ? [] : [entry.clientCleanup]
    );
    await cleanup.attempt(
      cleanups,
      closeGraceMs,
      "plugin proxy startup abort"
    );
    return createPluginProxyResult([], cleanup, closeGraceMs);
  }

  const servers: ProxiedServerInfo[] = [];
  const takenNames = new Set<string>();
  let totalRegistered = 0;

  for (const connection of connected) {
    if (connection === undefined) continue;
    const { plugin, spec } = connection.entry;
    const label = `plugin "${plugin.name}" server "${spec.name}"`;
    if (connection.toolsCapReason !== undefined) {
      log(`${label}: tool list capped: ${connection.toolsCapReason}`);
    }

    const registrations: ActiveRegistration[] = [];
    let registrationFailed = false;
    for (const [toolIndex, tool] of connection.tools.entries()) {
      if (totalRegistered >= MAX_TOOLS_TOTAL) {
        log(`${label}: global tool limit ${MAX_TOOLS_TOTAL} reached`);
        break;
      }
      if (tool.execution?.taskSupport === "required") {
        log(
          `${label} tool "${tool.name}" skipped: required task execution is unsupported`
        );
        continue;
      }

      const inputSchema =
        tool.inputSchema && typeof tool.inputSchema === "object"
          ? tool.inputSchema
          : { type: "object", properties: {} };
      let converted: unknown;
      try {
        assertSchemaWithinLimits(inputSchema);
        converted = options.factories.createInputSchema(inputSchema);
      } catch (error) {
        log(
          `${label} tool "${tool.name}" skipped: input schema conversion failed: ${errorMessage(error)}`
        );
        continue;
      }

      const exposedName = toolNamespace(
        plugin,
        spec.name,
        tool,
        toolIndex,
        takenNames
      );
      let handle: McpToolRegistration;
      try {
        handle = options.server.registerTool(
          exposedName,
          {
            description:
              `[${plugin.name}] ${tool.description ?? `Tool ${tool.name} from plugin ${plugin.name}`}`,
            inputSchema: converted,
          },
          async (input, extra) => {
            try {
              return await callWithBounds(
                connection.client,
                tool.name,
                input,
                extra,
                callMs
              );
            } catch (error) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `Plugin tool ${exposedName} failed: ${errorMessage(error)}`,
                  },
                ],
                isError: true,
              };
            }
          }
        );
        if (!handle || typeof handle.remove !== "function") {
          throw new Error("registerTool did not return a removal handle");
        }
      } catch (error) {
        log(`${label}: tool registration failed: ${errorMessage(error)}`);
        await cleanup.attempt(
          [
            ...registrations.map((registration) => registration.cleanup),
            connection.clientCleanup,
          ],
          closeGraceMs,
          `${label}: registration rollback`
        );
        registrationFailed = true;
        break;
      }

      takenNames.add(exposedName);
      registrations.push({
        name: exposedName,
        cleanup: cleanup.retain(
          `${label} tool "${exposedName}"`,
          () => handle.remove(),
          () => {
            takenNames.delete(exposedName);
            totalRegistered--;
          }
        ),
      });
      totalRegistered++;
    }

    if (registrationFailed) continue;
    if (registrations.length === 0) {
      await cleanup.attempt(
        [connection.clientCleanup],
        closeGraceMs,
        `${label}: unused client close`
      );
    }
    servers.push({
      plugin: plugin.name,
      server: spec.name,
      tools: registrations.length,
    });
    log(`${label}: ${registrations.length} tool(s) available`);
  }

  return createPluginProxyResult(servers, cleanup, closeGraceMs);
}
