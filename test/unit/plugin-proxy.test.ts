import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LoadedPlugin } from "../../src/extensions/plugins.js";
import {
  proxyPluginMcpServers,
  type McpClientLike,
  type PluginProxyFactories,
} from "../../src/mcp/plugin-proxy.js";
import type { McpCallResult, McpServerLike } from "../../src/mcp/adapter.js";

interface RegisteredTool {
  name: string;
  description: string;
  inputSchema: unknown;
  handler: (input: Record<string, unknown>) => Promise<McpCallResult>;
}

function fakeServer(): { server: McpServerLike; tools: RegisteredTool[] } {
  const tools: RegisteredTool[] = [];
  return {
    tools,
    server: {
      registerTool(name, config, handler) {
        tools.push({
          name,
          description: config.description,
          inputSchema: config.inputSchema,
          handler,
        });
      },
    },
  };
}

function fakePlugin(overrides: Partial<LoadedPlugin> = {}): LoadedPlugin {
  return {
    directory: "/plugins/acme",
    source: "project",
    name: "acme.tools",
    manifest: { name: "acme.tools" },
    skills: [],
    mcpServers: [
      {
        name: "main",
        type: "stdio",
        command: "acme-server",
        args: ["--fast"],
        env: { MODE: "test" },
      },
    ],
    diagnostics: [],
    ...overrides,
  };
}

interface FakeClientState {
  client: McpClientLike;
  closed: boolean;
  calls: Array<{ name: string; arguments?: Record<string, unknown> }>;
}

function fakeFactories(options: {
  tools?: Array<{ name: string; description?: string; inputSchema?: unknown }>;
  failConnect?: boolean;
  capturedEnv?: Record<string, Record<string, string>>;
  capturedCwd?: string[];
}): { factories: PluginProxyFactories; clients: FakeClientState[] } {
  const clients: FakeClientState[] = [];
  const factories: PluginProxyFactories = {
    createClient: () => {
      const state: FakeClientState = {
        closed: false,
        calls: [],
        client: undefined as unknown as McpClientLike,
      };
      state.client = {
        connect: async () => {
          if (options.failConnect) throw new Error("spawn failed");
        },
        listTools: async () => ({
          tools: options.tools ?? [
            {
              name: "do_thing",
              description: "Does a thing",
              inputSchema: { type: "object", properties: {} },
            },
          ],
        }),
        callTool: async (params) => {
          state.calls.push(params);
          return { content: [{ type: "text", text: "remote ok" }] };
        },
        close: async () => {
          state.closed = true;
        },
      };
      clients.push(state);
      return state.client;
    },
    createStdioTransport: (params) => {
      if (options.capturedEnv) options.capturedEnv["env"] = params.env;
      options.capturedCwd?.push(params.cwd);
      return { kind: "stdio", ...params };
    },
    createHttpTransport: (params) => ({ kind: "http", ...params }),
    createInputSchema: (schema) => ({ converted: schema }),
  };
  return { factories, clients };
}

describe("proxyPluginMcpServers", () => {
  it("registers remote tools namespaced as plugin__tool and forwards calls", async () => {
    const { server, tools } = fakeServer();
    const { factories, clients } = fakeFactories({});
    const proxy = await proxyPluginMcpServers({
      server,
      plugins: [fakePlugin()],
      factories,
      log: () => undefined,
    });

    expect(proxy.servers).toEqual([{ plugin: "acme.tools", server: "main", tools: 1 }]);
    expect(tools.map((tool) => tool.name)).toEqual(["acme-tools__do_thing"]);
    expect(tools[0].description).toContain("[acme.tools]");
    expect(tools[0].inputSchema).toEqual({
      converted: { type: "object", properties: {} },
    });

    const result = await tools[0].handler({ value: 1 });
    expect(result).toEqual({ content: [{ type: "text", text: "remote ok" }] });
    expect(clients[0].calls).toEqual([{ name: "do_thing", arguments: { value: 1 } }]);

    await proxy.close();
    expect(clients[0].closed).toBe(true);
  });

  it("injects PLUGIN_ROOT and PLUGIN_DATA after configured env and defaults cwd", async () => {
    const { server } = fakeServer();
    const capturedEnv: Record<string, Record<string, string>> = {};
    const capturedCwd: string[] = [];
    const home = mkdtempSync(join(tmpdir(), "tidesurf-plugin-proxy-home-"));
    try {
      const { factories } = fakeFactories({ capturedEnv, capturedCwd });
      await proxyPluginMcpServers({
        server,
        plugins: [fakePlugin()],
        factories,
        home,
        log: () => undefined,
      });

      expect(capturedCwd).toEqual(["/plugins/acme"]);
      const env = capturedEnv["env"];
      expect(env["MODE"]).toBe("test");
      expect(env["PLUGIN_ROOT"]).toBe("/plugins/acme");
      expect(env["PLUGIN_DATA"]).toBe(
        join(home, ".tidesurf", "plugin-data", "acme.tools")
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("isolates a server that fails to start and keeps going", async () => {
    const { server, tools } = fakeServer();
    const { factories } = fakeFactories({ failConnect: true });
    const logs: string[] = [];
    const proxy = await proxyPluginMcpServers({
      server,
      plugins: [fakePlugin()],
      factories,
      log: (message) => logs.push(message),
    });

    expect(tools).toEqual([]);
    expect(proxy.servers).toEqual([]);
    expect(logs.some((line) => line.includes("spawn failed"))).toBe(true);
  });

  it("skips duplicate exposed names instead of overwriting", async () => {
    const { server, tools } = fakeServer();
    const { factories } = fakeFactories({
      tools: [
        { name: "same", inputSchema: { type: "object" } },
        { name: "same", inputSchema: { type: "object" } },
      ],
    });
    const proxy = await proxyPluginMcpServers({
      server,
      plugins: [fakePlugin()],
      factories,
      log: () => undefined,
    });
    expect(tools.map((tool) => tool.name)).toEqual(["acme-tools__same"]);
    expect(proxy.servers[0].tools).toBe(1);
  });

  it("skips tools whose schema fails to convert", async () => {
    const { server, tools } = fakeServer();
    const { factories } = fakeFactories({});
    const throwingFactories: PluginProxyFactories = {
      ...factories,
      createInputSchema: () => {
        throw new Error("unsupported schema");
      },
    };
    const proxy = await proxyPluginMcpServers({
      server,
      plugins: [fakePlugin()],
      factories: throwingFactories,
      log: () => undefined,
    });
    expect(tools).toEqual([]);
    expect(proxy.servers[0].tools).toBe(0);
  });

  it("connects streamable-http servers through the http transport", async () => {
    const { server, tools } = fakeServer();
    const { factories } = fakeFactories({});
    const plugin = fakePlugin({
      mcpServers: [
        { name: "remote", type: "streamable-http", url: "https://api.example.com/mcp" },
      ],
    });
    const proxy = await proxyPluginMcpServers({
      server,
      plugins: [plugin],
      factories,
      log: () => undefined,
    });
    expect(tools.map((tool) => tool.name)).toEqual(["acme-tools__do_thing"]);
    expect(proxy.servers).toEqual([{ plugin: "acme.tools", server: "remote", tools: 1 }]);
  });

  it("returns isError results instead of throwing on call failure", async () => {
    const { server, tools } = fakeServer();
    const clients: FakeClientState[] = [];
    const factories: PluginProxyFactories = {
      createClient: () => {
        const state: FakeClientState = {
          closed: false,
          calls: [],
          client: {
            connect: async () => undefined,
            listTools: async () => ({
              tools: [{ name: "boom", inputSchema: { type: "object" } }],
            }),
            callTool: async () => {
              throw new Error("server crashed");
            },
            close: async () => {
              state.closed = true;
            },
          },
        };
        clients.push(state);
        return state.client;
      },
      createStdioTransport: () => ({}),
      createHttpTransport: () => ({}),
      createInputSchema: (schema) => schema,
    };
    await proxyPluginMcpServers({
      server,
      plugins: [fakePlugin()],
      factories,
      log: () => undefined,
    });
    const result = await tools[0].handler({});
    expect(result.isError).toBe(true);
    expect(result.content[0]).toEqual({
      type: "text",
      text: "Plugin tool acme-tools__boom failed: server crashed",
    });
  });
});
