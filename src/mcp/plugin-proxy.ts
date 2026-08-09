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
const MAX_SCHEMA_BYTES = 256 * 1024;
const MAX_SCHEMA_DEPTH = 64;
const MAX_TOOL_CALL_MS = 30_000;
const MAX_RESULT_BYTES = 16 * 1024 * 1024;
const MAX_TOOL_NAME_BYTES = 64;
const TOOL_NAME_HASH_BYTES = 12;
const CLOSE_GRACE_MS = 2_000;

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

async function withAbsoluteDeadline<T>(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
  operation: (signal: AbortSignal, deadline: number) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  const deadline = Date.now() + timeoutMs;
  const timeoutError = new Error(`startup timed out after ${timeoutMs}ms`);
  const timer = setTimeout(() => controller.abort(timeoutError), timeoutMs);
  const onParentAbort = () => {
    controller.abort(abortError(parentSignal?.reason, "plugin proxy startup cancelled"));
  };
  if (parentSignal?.aborted) onParentAbort();
  else parentSignal?.addEventListener("abort", onParentAbort, { once: true });

  const aborted = controller.signal.aborted
    ? Promise.reject<T>(abortError(controller.signal.reason, "plugin proxy startup cancelled"))
    : new Promise<T>((_resolve, reject) => {
        controller.signal.addEventListener(
          "abort",
          () => reject(abortError(controller.signal.reason, "plugin proxy startup cancelled")),
          { once: true }
        );
      });
  const pending = Promise.resolve().then(() =>
    operation(controller.signal, deadline)
  );
  try {
    return await Promise.race([pending, aborted]);
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", onParentAbort);
  }
}

interface GraceResult {
  readonly results?: readonly PromiseSettledResult<void>[];
  readonly timedOut: boolean;
}

async function settleWithGrace(
  operations: readonly (() => void | Promise<void>)[],
  graceMs: number
): Promise<GraceResult> {
  if (operations.length === 0) return { results: [], timedOut: false };
  const pending = operations.map((operation) =>
    Promise.resolve().then(operation).then(() => undefined)
  );
  const settled = Promise.allSettled(pending);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolveTimeout) => {
    timer = setTimeout(() => resolveTimeout(undefined), graceMs);
  });
  const results = await Promise.race([settled, timeout]);
  if (timer !== undefined) clearTimeout(timer);
  return results === undefined
    ? { timedOut: true }
    : { results, timedOut: false };
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
  readonly tools: readonly RemoteTool[];
  readonly toolsCapped: boolean;
}

async function listRemoteTools(
  client: McpClientLike,
  signal: AbortSignal,
  deadline: number
): Promise<{ tools: RemoteTool[]; capped: boolean }> {
  const tools: RemoteTool[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const response = await client.listTools(
      cursor === undefined ? {} : { cursor },
      requestOptions(signal, deadline)
    );
    if (!Array.isArray(response.tools)) {
      throw new Error("tools/list returned an invalid tools array");
    }
    const available = MAX_TOOLS_PER_SERVER - tools.length;
    if (response.tools.length > available) {
      tools.push(...response.tools.slice(0, available));
      return { tools, capped: true };
    }
    tools.push(...response.tools);
    if (tools.length === MAX_TOOLS_PER_SERVER) {
      return { tools, capped: response.nextCursor !== undefined };
    }

    const next = response.nextCursor;
    if (next === undefined) return { tools, capped: false };
    if (seenCursors.has(next)) {
      throw new Error(`tools/list repeated cursor ${JSON.stringify(next)}`);
    }
    seenCursors.add(next);
    cursor = next;
  }
  throw new Error(`tools/list exceeded ${MAX_LIST_PAGES} pages`);
}

async function connectServer(
  entry: ServerEntry,
  factories: PluginProxyFactories,
  parentSignal: AbortSignal | undefined,
  startupMs: number,
  closeGraceMs: number,
  log: (message: string) => void
): Promise<ConnectedServer | undefined> {
  let client: McpClientLike | undefined;
  try {
    return await withAbsoluteDeadline(
      parentSignal,
      startupMs,
      async (signal, deadline) => {
        if (signal.aborted) {
          throw abortError(signal.reason, "plugin proxy startup cancelled");
        }
        client = factories.createClient();
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
          });
        }
        await client.connect(transport, requestOptions(signal, deadline));
        const listed = await listRemoteTools(client, signal, deadline);
        return {
          entry,
          client,
          tools: listed.tools,
          toolsCapped: listed.capped,
        };
      }
    );
  } catch (error) {
    if (client !== undefined) {
      await settleWithGrace([() => client!.close()], closeGraceMs);
    }
    log(
      `plugin "${entry.plugin.name}" server "${entry.spec.name}" failed to start: ${errorMessage(error)}`
    );
    return undefined;
  }
}

interface ActiveRegistration {
  readonly name: string;
  readonly handle: McpToolRegistration;
}

interface ActiveClient {
  readonly client: McpClientLike;
  readonly registrations: readonly ActiveRegistration[];
}

async function rollbackClient(
  registrations: readonly ActiveRegistration[],
  client: McpClientLike,
  takenNames: Set<string>,
  closeGraceMs: number,
  log: (message: string) => void,
  label: string
): Promise<number> {
  const operations: Array<() => void | Promise<void>> = [
    ...registrations.map((registration) => () => registration.handle.remove()),
    () => client.close(),
  ];
  const cleanup = await settleWithGrace(operations, closeGraceMs);
  if (cleanup.timedOut || cleanup.results === undefined) {
    log(`${label}: rollback exceeded ${closeGraceMs}ms grace`);
    return 0;
  }

  let removed = 0;
  for (let index = 0; index < registrations.length; index++) {
    const result = cleanup.results[index];
    if (result?.status === "fulfilled") {
      takenNames.delete(registrations[index].name);
      removed++;
    } else if (result?.status === "rejected") {
      log(`${label}: tool removal failed: ${errorMessage(result.reason)}`);
    }
  }
  const clientResult = cleanup.results[registrations.length];
  if (clientResult?.status === "rejected") {
    log(`${label}: client close failed: ${errorMessage(clientResult.reason)}`);
  }
  return removed;
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
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      if (options.signal?.aborted) return;
      const index = nextIndex++;
      if (index >= selected.length) return;
      connected[index] = await connectServer(
        selected[index],
        options.factories,
        options.signal,
        startupMs,
        closeGraceMs,
        log
      );
    }
  };
  await Promise.allSettled(
    Array.from(
      { length: Math.min(STARTUP_CONCURRENCY, selected.length) },
      () => worker()
    )
  );

  if (options.signal?.aborted) {
    const clients = connected.flatMap((entry) =>
      entry === undefined ? [] : [entry.client]
    );
    await settleWithGrace(
      clients.map((client) => () => client.close()),
      closeGraceMs
    );
    let closed: Promise<void> | undefined;
    return {
      servers: [],
      close: () => closed ??= Promise.resolve(),
    };
  }

  const servers: ProxiedServerInfo[] = [];
  const activeClients: ActiveClient[] = [];
  const takenNames = new Set<string>();
  let totalRegistered = 0;

  for (const connection of connected) {
    if (connection === undefined) continue;
    const { plugin, spec } = connection.entry;
    const label = `plugin "${plugin.name}" server "${spec.name}"`;
    if (connection.toolsCapped) {
      log(`${label}: tool list capped at ${MAX_TOOLS_PER_SERVER}`);
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
        const removed = await rollbackClient(
          registrations,
          connection.client,
          takenNames,
          closeGraceMs,
          log,
          label
        );
        totalRegistered -= removed;
        registrationFailed = true;
        break;
      }

      takenNames.add(exposedName);
      registrations.push({ name: exposedName, handle });
      totalRegistered++;
    }

    if (registrationFailed) continue;
    if (registrations.length > 0) {
      activeClients.push({
        client: connection.client,
        registrations,
      });
    } else {
      const cleanup = await settleWithGrace(
        [() => connection.client.close()],
        closeGraceMs
      );
      if (cleanup.timedOut) log(`${label}: client close exceeded ${closeGraceMs}ms grace`);
      else if (cleanup.results?.[0]?.status === "rejected") {
        log(
          `${label}: client close failed: ${errorMessage(cleanup.results[0].reason)}`
        );
      }
    }
    servers.push({
      plugin: plugin.name,
      server: spec.name,
      tools: registrations.length,
    });
    log(`${label}: ${registrations.length} tool(s) available`);
  }

  let closePromise: Promise<void> | undefined;
  return {
    servers,
    close: () => {
      closePromise ??= (async () => {
        const operations: Array<() => void | Promise<void>> = [];
        for (const active of activeClients) {
          for (const registration of active.registrations) {
            operations.push(() => registration.handle.remove());
          }
          operations.push(() => active.client.close());
        }
        const cleanup = await settleWithGrace(operations, closeGraceMs);
        if (cleanup.timedOut) {
          log(`plugin proxy close exceeded ${closeGraceMs}ms grace`);
          return;
        }
        for (const result of cleanup.results ?? []) {
          if (result.status === "rejected") {
            log(`plugin proxy close operation failed: ${errorMessage(result.reason)}`);
          }
        }
      })();
      return closePromise;
    },
  };
}
