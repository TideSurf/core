import { afterEach, describe, expect, it } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LoadedPlugin } from "../../src/extensions/plugins.js";
import type {
  McpCallResult,
  McpRequestHandlerExtra,
  McpServerLike,
  McpToolRegistration,
} from "../../src/mcp/adapter.js";
import {
  buildPluginStdioEnvironment,
  proxyPluginMcpServers,
  type McpClientLike,
  type McpRequestOptionsLike,
  type PluginProxyFactories,
} from "../../src/mcp/plugin-proxy.js";

interface RemoteToolFixture {
  name: string;
  description?: string;
  inputSchema?: unknown;
  execution?: { taskSupport?: "optional" | "required" | "forbidden" };
}

interface RegisteredTool {
  name: string;
  description: string;
  inputSchema: unknown;
  handler: (
    input: Record<string, unknown>,
    extra: McpRequestHandlerExtra
  ) => Promise<McpCallResult>;
  active: boolean;
  removeCalls: number;
}

interface FakeServerOptions {
  failRegistrationAt?: number;
  remove?: (
    registration: RegisteredTool,
    index: number
  ) => void | Promise<void>;
}

class FakeServer implements McpServerLike {
  readonly registrations: RegisteredTool[] = [];
  registrationAttempts = 0;

  constructor(private readonly options: FakeServerOptions = {}) {}

  registerTool(
    name: string,
    config: { description: string; inputSchema: unknown },
    handler: RegisteredTool["handler"]
  ): McpToolRegistration {
    this.registrationAttempts++;
    if (this.registrationAttempts === this.options.failRegistrationAt) {
      throw new Error("host registration failed");
    }
    const registration: RegisteredTool = {
      name,
      description: config.description,
      inputSchema: config.inputSchema,
      handler,
      active: true,
      removeCalls: 0,
    };
    const index = this.registrations.length;
    this.registrations.push(registration);
    return {
      remove: () => {
        registration.removeCalls++;
        const result = this.options.remove?.(registration, index);
        if (result instanceof Promise) {
          return result.then(() => { registration.active = false; });
        }
        registration.active = false;
      },
    };
  }

  visible(): RegisteredTool[] {
    return this.registrations.filter((registration) => registration.active);
  }
}

interface ListCall {
  params: { readonly cursor?: string } | undefined;
  options: McpRequestOptionsLike | undefined;
}

interface CallRecord {
  params: { name: string; arguments?: Record<string, unknown> };
  resultSchema: undefined;
  options: McpRequestOptionsLike | undefined;
}

interface ClientState {
  readonly client: McpClientLike;
  key?: string;
  closeCalls: number;
  readonly connectOptions: Array<McpRequestOptionsLike | undefined>;
  readonly listCalls: ListCall[];
  readonly callRecords: CallRecord[];
}

interface Behavior {
  tools?: RemoteToolFixture[];
  connect?: (
    state: ClientState,
    options: McpRequestOptionsLike | undefined
  ) => void | Promise<void>;
  listTools?: (
    params: { readonly cursor?: string } | undefined,
    options: McpRequestOptionsLike | undefined,
    state: ClientState
  ) =>
    | { tools: RemoteToolFixture[]; nextCursor?: string }
    | Promise<{ tools: RemoteToolFixture[]; nextCursor?: string }>;
  callTool?: (
    record: CallRecord,
    state: ClientState
  ) => unknown | Promise<unknown>;
  close?: (state: ClientState) => void | Promise<void>;
}

interface FactoryHarness {
  readonly factories: PluginProxyFactories;
  readonly clients: ClientState[];
  readonly stdioParams: Array<{
    command: string;
    args: readonly string[];
    env: Record<string, string>;
    cwd: string;
  }>;
}

function harness(
  behaviors: Readonly<Record<string, Behavior>> = {},
  createInputSchema: (schema: unknown) => unknown = (schema) => ({ converted: schema })
): FactoryHarness {
  const clients: ClientState[] = [];
  const stdioParams: FactoryHarness["stdioParams"] = [];
  const behaviorFor = (state: ClientState): Behavior =>
    behaviors[state.key ?? ""] ?? {};

  const factories: PluginProxyFactories = {
    createClient: () => {
      const state: ClientState = {
        client: undefined as unknown as McpClientLike,
        closeCalls: 0,
        connectOptions: [],
        listCalls: [],
        callRecords: [],
      };
      state.client = {
        connect: async (transport, options) => {
          const descriptor = transport as { key: string };
          state.key = descriptor.key;
          state.connectOptions.push(options);
          await behaviorFor(state).connect?.(state, options);
        },
        listTools: async (params, options) => {
          state.listCalls.push({ params, options });
          const behavior = behaviorFor(state);
          if (behavior.listTools) {
            return await behavior.listTools(params, options, state);
          }
          return {
            tools: behavior.tools ?? [
              {
                name: "do_thing",
                description: "Does a thing",
                inputSchema: { type: "object", properties: {} },
              },
            ],
          };
        },
        callTool: async (params, resultSchema, options) => {
          const record = { params, resultSchema, options };
          state.callRecords.push(record);
          const behavior = behaviorFor(state);
          if (behavior.callTool) return await behavior.callTool(record, state);
          return { content: [{ type: "text", text: "remote ok" }] };
        },
        close: async () => {
          state.closeCalls++;
          await behaviorFor(state).close?.(state);
        },
      };
      clients.push(state);
      return state.client;
    },
    createStdioTransport: (params) => {
      stdioParams.push({
        command: params.command,
        args: params.args,
        env: params.env,
        cwd: params.cwd,
      });
      return { key: params.command };
    },
    createHttpTransport: (params) => ({ key: params.url }),
    createInputSchema,
  };
  return { factories, clients, stdioParams };
}

let tempDirectories: string[] = [];

function makeTemp(): string {
  const directory = mkdtempSync(join(tmpdir(), "tidesurf-plugin-proxy-"));
  tempDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of tempDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  tempDirectories = [];
});

function fakePlugin(options: {
  name?: string;
  servers?: string[];
  dataDirectory?: string;
  type?: "stdio" | "streamable-http";
} = {}): LoadedPlugin {
  const name = options.name ?? "acme";
  const directory = makeTemp();
  const dataDirectory = options.dataDirectory ?? join(makeTemp(), "data");
  const serverNames = options.servers ?? ["main"];
  return {
    directory,
    dataDirectory,
    source: "user",
    name,
    manifest: { name },
    skills: [],
    mcpServers: serverNames.map((serverName) =>
      options.type === "streamable-http"
        ? {
            name: serverName,
            type: "streamable-http" as const,
            url: `https://example.test/${serverName}`,
          }
        : {
            name: serverName,
            type: "stdio" as const,
            command: serverName,
            args: ["--fixture"],
            env: { MODE: serverName },
            cwd: directory,
          }
    ),
    diagnostics: [],
  };
}

function tool(name: string, inputSchema: unknown = { type: "object" }): RemoteToolFixture {
  return { name, inputSchema };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function waitFor(predicate: () => boolean, timeout = 1_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition was not reached");
    await delay(1);
  }
}

function never<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

const handlerExtra = (): McpRequestHandlerExtra => ({
  signal: new AbortController().signal,
});

describe("plugin proxy SDK contracts and deterministic ordering", () => {
  it("registers in manifest order and uses listTools params/options plus callTool third options", async () => {
    const host = new FakeServer();
    const fixture = harness({
      slow: {
        connect: () => delay(20),
        tools: [tool("slow_tool")],
      },
      fast: {
        connect: () => delay(1),
        tools: [tool("fast_tool")],
      },
    });
    const proxy = await proxyPluginMcpServers({
      server: host,
      plugins: [fakePlugin({ servers: ["slow", "fast"] })],
      factories: fixture.factories,
    });

    expect(host.visible().map((entry) => entry.name)).toEqual([
      "acme__slow_tool",
      "acme__fast_tool",
    ]);
    expect(proxy.servers).toEqual([
      { plugin: "acme", server: "slow", tools: 1 },
      { plugin: "acme", server: "fast", tools: 1 },
    ]);
    const slowClient = fixture.clients.find((client) => client.key === "slow")!;
    expect(slowClient.listCalls[0].params).toEqual({});
    expect(slowClient.listCalls[0].options?.maxTotalTimeout).toBeGreaterThan(0);

    const extra = handlerExtra();
    const result = await host.visible()[0].handler({ value: 1 }, extra);
    expect(result).toEqual({ content: [{ type: "text", text: "remote ok" }] });
    expect(slowClient.callRecords[0]).toMatchObject({
      params: { name: "slow_tool", arguments: { value: 1 } },
      resultSchema: undefined,
      options: {
        signal: extra.signal,
        timeout: 30_000,
        maxTotalTimeout: 30_000,
        resetTimeoutOnProgress: false,
      },
    });

    await proxy.close();
    expect(host.visible()).toEqual([]);
    expect(fixture.clients.every((client) => client.closeCalls === 1)).toBe(true);
  });

  it("keeps streamable HTTP transport behavior", async () => {
    const host = new FakeServer();
    const fixture = harness({
      "https://example.test/remote": { tools: [tool("remote_tool")] },
    });
    const proxy = await proxyPluginMcpServers({
      server: host,
      plugins: [fakePlugin({ servers: ["remote"], type: "streamable-http" })],
      factories: fixture.factories,
    });
    expect(host.visible().map((entry) => entry.name)).toEqual([
      "acme__remote_tool",
    ]);
    await proxy.close();
  });
});

describe("plugin stdio trust boundaries", () => {
  it("inherits only the SDK-safe allowlist and injects reserved values last", () => {
    const env = buildPluginStdioEnvironment({
      inherited: {
        HOME: "/home/alice",
        PATH: "/safe/bin",
        SHELL: "() malicious function",
        AWS_SECRET_ACCESS_KEY: "secret",
        NODE_OPTIONS: "--require=/tmp/attack.js",
      },
      configured: {
        MODE: "configured",
        PLUGIN_ROOT: "/attacker/root",
        PLUGIN_DATA: "/attacker/data",
        TIDESURF_PLUGIN_MCP_CHILD: "0",
      },
      pluginRoot: "/plugins/acme",
      pluginData: "/data/acme",
      platform: "linux",
    });

    expect(env).toEqual({
      HOME: "/home/alice",
      PATH: "/safe/bin",
      MODE: "configured",
      PLUGIN_ROOT: "/plugins/acme",
      PLUGIN_DATA: "/data/acme",
      TIDESURF_PLUGIN_MCP_CHILD: "1",
    });
  });

  it("overlays Windows environment names case-insensitively without duplicate aliases", () => {
    const env = buildPluginStdioEnvironment({
      inherited: {
        Path: "C:\\safe",
        temp: "C:\\Temp",
        Secret: "hidden",
      },
      configured: {
        path: "C:\\configured",
        PATH: "C:\\last",
        plugin_root: "C:\\bad-root",
        Plugin_Data: "C:\\bad-data",
        tidesurf_plugin_mcp_child: "0",
      },
      pluginRoot: "C:\\plugins\\acme",
      pluginData: "C:\\data\\acme",
      platform: "win32",
    });

    expect(env.PATH).toBe("C:\\last");
    expect(env.TEMP).toBe("C:\\Temp");
    expect(env.PLUGIN_ROOT).toBe("C:\\plugins\\acme");
    expect(env.PLUGIN_DATA).toBe("C:\\data\\acme");
    expect(env.TIDESURF_PLUGIN_MCP_CHILD).toBe("1");
    expect(Object.keys(env).filter((name) => name.toUpperCase() === "PATH")).toEqual(["PATH"]);
    expect(Object.keys(env).filter((name) => name.toUpperCase() === "PLUGIN_ROOT")).toEqual([
      "PLUGIN_ROOT",
    ]);
    expect(Object.keys(env).some((name) => name.toUpperCase() === "SECRET")).toBe(false);
  });

  it("creates and repairs plugin data mode to 0700 before spawning", async () => {
    const dataDirectory = join(makeTemp(), "private-data");
    mkdirSync(dataDirectory, { recursive: true, mode: 0o777 });
    chmodSync(dataDirectory, 0o777);
    const host = new FakeServer();
    const fixture = harness({ main: { tools: [tool("ok")] } });
    const plugin = fakePlugin({ dataDirectory });
    const proxy = await proxyPluginMcpServers({
      server: host,
      plugins: [plugin],
      factories: fixture.factories,
    });

    if (process.platform !== "win32") {
      expect(statSync(dataDirectory).mode & 0o777).toBe(0o700);
    }
    expect(fixture.stdioParams[0].env.PLUGIN_ROOT).toBe(plugin.directory);
    expect(fixture.stdioParams[0].env.PLUGIN_DATA).toBe(dataDirectory);
    expect(fixture.stdioParams[0].env.TIDESURF_PLUGIN_MCP_CHILD).toBe("1");
    await proxy.close();
  });
});

describe("plugin proxy startup bounds", () => {
  it("starts at most four servers concurrently", async () => {
    let active = 0;
    let maximum = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolveGate) => { release = resolveGate; });
    const behavior: Behavior = {
      connect: async () => {
        active++;
        maximum = Math.max(maximum, active);
        await gate;
        active--;
      },
      tools: [tool("ok")],
    };
    const names = Array.from({ length: 8 }, (_, index) => `server-${index}`);
    const fixture = harness(Object.fromEntries(names.map((name) => [name, behavior])));
    const pending = proxyPluginMcpServers({
      server: new FakeServer(),
      plugins: [fakePlugin({ servers: names })],
      factories: fixture.factories,
    });

    await waitFor(() => maximum === 4);
    expect(active).toBe(4);
    release();
    const proxy = await pending;
    expect(maximum).toBe(4);
    await proxy.close();
  });

  it("starts only the first 32 declared servers", async () => {
    const names = Array.from({ length: 35 }, (_, index) => `server-${index}`);
    const logs: string[] = [];
    const fixture = harness();
    const proxy = await proxyPluginMcpServers({
      server: new FakeServer(),
      plugins: [fakePlugin({ servers: names })],
      factories: fixture.factories,
      log: (line) => logs.push(line),
    });

    expect(fixture.clients).toHaveLength(32);
    expect(proxy.servers).toHaveLength(32);
    expect(logs.some((line) => line.includes("first 32 of 35"))).toBe(true);
    await proxy.close();
  });

  it("bounds both connect and tools/list and closes timed-out clients", async () => {
    const logs: string[] = [];
    const fixture = harness({
      connectHang: { connect: () => never<void>() },
      listHang: { listTools: () => never() },
    });
    const started = Date.now();
    const proxy = await proxyPluginMcpServers({
      server: new FakeServer(),
      plugins: [fakePlugin({ servers: ["connectHang", "listHang"] })],
      factories: fixture.factories,
      log: (line) => logs.push(line),
      timeouts: { startupMs: 20, closeGraceMs: 20 },
    });

    expect(Date.now() - started).toBeLessThan(250);
    expect(proxy.servers).toEqual([]);
    expect(fixture.clients.every((client) => client.closeCalls === 1)).toBe(true);
    expect(logs.filter((line) => line.includes("timed out after 20ms"))).toHaveLength(2);
  });

  it("honors a parent abort while startup is pending", async () => {
    const controller = new AbortController();
    const fixture = harness({ hanging: { connect: () => never<void>() } });
    const pending = proxyPluginMcpServers({
      server: new FakeServer(),
      plugins: [fakePlugin({ servers: ["hanging"] })],
      factories: fixture.factories,
      signal: controller.signal,
      timeouts: { startupMs: 1_000, closeGraceMs: 20 },
    });
    await waitFor(() => fixture.clients.length === 1);
    controller.abort(new Error("parent stopped"));
    const proxy = await pending;

    expect(proxy.servers).toEqual([]);
    expect(fixture.clients[0].connectOptions[0]?.signal?.aborted).toBe(true);
    expect(fixture.clients[0].closeCalls).toBe(1);
    await proxy.close();
  });
});

describe("tools/list pagination and resource caps", () => {
  it("paginates with cursors and preserves page order", async () => {
    const fixture = harness({
      paged: {
        listTools: (params) =>
          params?.cursor === undefined
            ? { tools: [tool("first")], nextCursor: "page-2" }
            : { tools: [tool("second")] },
      },
    });
    const host = new FakeServer();
    const proxy = await proxyPluginMcpServers({
      server: host,
      plugins: [fakePlugin({ servers: ["paged"] })],
      factories: fixture.factories,
    });

    expect(fixture.clients[0].listCalls.map((call) => call.params)).toEqual([
      {},
      { cursor: "page-2" },
    ]);
    expect(host.visible().map((entry) => entry.name)).toEqual([
      "acme__first",
      "acme__second",
    ]);
    await proxy.close();
  });

  it("rejects repeated cursors instead of looping", async () => {
    const logs: string[] = [];
    const fixture = harness({
      repeated: {
        listTools: () => ({ tools: [], nextCursor: "same" }),
      },
    });
    const proxy = await proxyPluginMcpServers({
      server: new FakeServer(),
      plugins: [fakePlugin({ servers: ["repeated"] })],
      factories: fixture.factories,
      log: (line) => logs.push(line),
    });

    expect(fixture.clients[0].listCalls).toHaveLength(2);
    expect(fixture.clients[0].closeCalls).toBe(1);
    expect(proxy.servers).toEqual([]);
    expect(logs.some((line) => line.includes("repeated cursor"))).toBe(true);
  });

  it("fails a server after at most 100 pagination pages", async () => {
    const fixture = harness({
      endless: {
        listTools: (params) => {
          const page = params?.cursor === undefined ? 0 : Number(params.cursor);
          return { tools: [], nextCursor: String(page + 1) };
        },
      },
    });
    const proxy = await proxyPluginMcpServers({
      server: new FakeServer(),
      plugins: [fakePlugin({ servers: ["endless"] })],
      factories: fixture.factories,
    });

    expect(fixture.clients[0].listCalls).toHaveLength(100);
    expect(fixture.clients[0].closeCalls).toBe(1);
    expect(proxy.servers).toEqual([]);
  });

  it("caps tools at 128 per server and 256 globally", async () => {
    const names = ["one", "two", "three"];
    const behaviors = Object.fromEntries(
      names.map((name) => [
        name,
        {
          tools: Array.from({ length: 130 }, (_, index) => tool(`${name}_${index}`)),
        },
      ])
    );
    const host = new FakeServer();
    const proxy = await proxyPluginMcpServers({
      server: host,
      plugins: [fakePlugin({ servers: names })],
      factories: harness(behaviors).factories,
    });

    expect(host.visible()).toHaveLength(256);
    expect(proxy.servers.map((entry) => entry.tools)).toEqual([128, 128, 0]);
    await proxy.close();
  });
});

describe("schema, task, and naming defenses", () => {
  it("skips oversized, over-deep, and task-required tools before conversion", async () => {
    let deep: unknown = { type: "string" };
    for (let index = 0; index < 65; index++) deep = { nested: deep };
    const converted: unknown[] = [];
    const fixture = harness(
      {
        main: {
          tools: [
            tool("oversized", {
              type: "object",
              description: "x".repeat(256 * 1024),
            }),
            tool("deep", deep),
            {
              ...tool("task"),
              execution: { taskSupport: "required" },
            },
            tool("valid", { type: "object", properties: {} }),
          ],
        },
      },
      (schema) => {
        converted.push(schema);
        return schema;
      }
    );
    const host = new FakeServer();
    const logs: string[] = [];
    const proxy = await proxyPluginMcpServers({
      server: host,
      plugins: [fakePlugin()],
      factories: fixture.factories,
      log: (line) => logs.push(line),
    });

    expect(converted).toHaveLength(1);
    expect(host.visible().map((entry) => entry.name)).toEqual(["acme__valid"]);
    expect(logs.some((line) => line.includes("262144-byte limit"))).toBe(true);
    expect(logs.some((line) => line.includes("depth limit 64"))).toBe(true);
    expect(logs.some((line) => line.includes("required task execution"))).toBe(true);
    await proxy.close();
  });

  it("does not reserve a name until conversion and registration succeed", async () => {
    const fixture = harness(
      {
        main: {
          tools: [
            tool("same", { fail: true }),
            tool("same", { type: "object" }),
          ],
        },
      },
      (schema) => {
        if ((schema as { fail?: boolean }).fail) throw new Error("bad schema");
        return schema;
      }
    );
    const host = new FakeServer();
    const proxy = await proxyPluginMcpServers({
      server: host,
      plugins: [fakePlugin()],
      factories: fixture.factories,
    });

    expect(host.visible().map((entry) => entry.name)).toEqual(["acme__same"]);
    await proxy.close();
  });

  it("uses deterministic hashed suffixes for sanitization, truncation, and server collisions", async () => {
    const run = async (): Promise<string[]> => {
      const longName = "x".repeat(100);
      const fixture = harness({
        first: { tools: [tool("same"), tool("a.b"), tool(longName)] },
        second: { tools: [tool("same"), tool("a-b")] },
      });
      const host = new FakeServer();
      const proxy = await proxyPluginMcpServers({
        server: host,
        plugins: [fakePlugin({ servers: ["first", "second"] })],
        factories: fixture.factories,
      });
      const names = host.visible().map((entry) => entry.name);
      await proxy.close();
      return names;
    };

    const first = await run();
    const second = await run();
    expect(first).toEqual(second);
    expect(first[0]).toBe("acme__same");
    expect(first[3]).toMatch(/^acme__same-[a-f0-9]{12}$/);
    expect(first[1]).toMatch(/^acme__a-b-[a-f0-9]{12}$/);
    expect(first[4]).toBe("acme__a-b");
    expect(new Set(first).size).toBe(first.length);
    for (const name of first) {
      expect(Buffer.byteLength(name)).toBeLessThanOrEqual(64);
      expect(name).toMatch(/^[a-zA-Z0-9_-]+$/);
    }
  });
});

describe("tool call cancellation and result bounds", () => {
  it("forwards cancellation to the client request and returns an MCP error", async () => {
    const fixture = harness({
      main: { callTool: () => never() },
    });
    const host = new FakeServer();
    const proxy = await proxyPluginMcpServers({
      server: host,
      plugins: [fakePlugin()],
      factories: fixture.factories,
      timeouts: { callMs: 500 },
    });
    const controller = new AbortController();
    const pending = host.visible()[0].handler({}, { signal: controller.signal });
    await waitFor(() => fixture.clients[0].callRecords.length === 1);
    controller.abort(new Error("caller cancelled"));
    const result = await pending;

    expect(fixture.clients[0].callRecords[0].options?.signal).toBe(controller.signal);
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("caller cancelled"),
    });
    await proxy.close();
  });

  it("applies an absolute tool call timeout", async () => {
    const fixture = harness({ main: { callTool: () => never() } });
    const host = new FakeServer();
    const proxy = await proxyPluginMcpServers({
      server: host,
      plugins: [fakePlugin()],
      factories: fixture.factories,
      timeouts: { callMs: 15 },
    });
    const result = await host.visible()[0].handler({}, handlerExtra());

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      text: expect.stringContaining("timed out after 15ms"),
    });
    expect(fixture.clients[0].callRecords[0].options?.maxTotalTimeout).toBe(15);
    await proxy.close();
  });

  it("rejects a result whose serialized form exceeds 16 MiB after receipt", async () => {
    const fixture = harness({
      main: {
        callTool: () => ({
          content: [{ type: "text", text: "x".repeat(16 * 1024 * 1024) }],
        }),
      },
    });
    const host = new FakeServer();
    const proxy = await proxyPluginMcpServers({
      server: host,
      plugins: [fakePlugin()],
      factories: fixture.factories,
    });
    const result = await host.visible()[0].handler({}, handlerExtra());

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      text: expect.stringContaining("16777216-byte limit"),
    });
    await proxy.close();
  });
});

describe("registration rollback and bounded close", () => {
  it("rolls back one client's tools, closes it, and continues with the next server", async () => {
    const host = new FakeServer({ failRegistrationAt: 2 });
    const fixture = harness({
      broken: { tools: [tool("one"), tool("two")] },
      healthy: { tools: [tool("one")] },
    });
    const logs: string[] = [];
    const proxy = await proxyPluginMcpServers({
      server: host,
      plugins: [fakePlugin({ servers: ["broken", "healthy"] })],
      factories: fixture.factories,
      log: (line) => logs.push(line),
    });

    expect(host.visible().map((entry) => entry.name)).toEqual(["acme__one"]);
    expect(proxy.servers).toEqual([
      { plugin: "acme", server: "healthy", tools: 1 },
    ]);
    expect(fixture.clients.find((client) => client.key === "broken")?.closeCalls).toBe(1);
    expect(logs.some((line) => line.includes("tool registration failed"))).toBe(true);
    await proxy.close();
  });

  it("all-settles removal and client close failures", async () => {
    const host = new FakeServer({
      remove: (_registration, index) => {
        if (index === 0) throw new Error("remove failed");
      },
    });
    const fixture = harness({
      main: {
        tools: [tool("one"), tool("two")],
        close: () => { throw new Error("close failed"); },
      },
    });
    const logs: string[] = [];
    const proxy = await proxyPluginMcpServers({
      server: host,
      plugins: [fakePlugin()],
      factories: fixture.factories,
      log: (line) => logs.push(line),
    });

    await proxy.close();
    expect(host.registrations.map((entry) => entry.removeCalls)).toEqual([1, 1]);
    expect(fixture.clients[0].closeCalls).toBe(1);
    expect(logs.filter((line) => line.includes("close operation failed"))).toHaveLength(2);
  });

  it("makes close idempotent and bounds hanging cleanup", async () => {
    const host = new FakeServer({ remove: () => never<void>() });
    const fixture = harness({
      main: {
        tools: [tool("one")],
        close: () => never<void>(),
      },
    });
    const logs: string[] = [];
    const proxy = await proxyPluginMcpServers({
      server: host,
      plugins: [fakePlugin()],
      factories: fixture.factories,
      log: (line) => logs.push(line),
      timeouts: { closeGraceMs: 20 },
    });

    const started = Date.now();
    const first = proxy.close();
    const second = proxy.close();
    expect(first).toBe(second);
    await first;
    expect(Date.now() - started).toBeLessThan(250);
    expect(host.registrations[0].removeCalls).toBe(1);
    expect(fixture.clients[0].closeCalls).toBe(1);
    expect(logs.some((line) => line.includes("close exceeded 20ms grace"))).toBe(true);
  });
});
