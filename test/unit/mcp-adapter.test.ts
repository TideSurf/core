import {
  createZodInputSchemaFactory,
  registerMcpTools,
  type McpCallResult,
  type McpServerLike,
} from "../../src/mcp/adapter.js";
import { getToolDefinitions } from "../../src/tools/registry.js";
import type { ToolExecutor } from "../../src/tools/registry.js";

interface Registration {
  config: { description: string; inputSchema: unknown };
  handler: (input: Record<string, unknown>) => Promise<McpCallResult>;
}

class FakeServer implements McpServerLike {
  readonly tools = new Map<string, Registration>();

  registerTool(
    name: string,
    config: Registration["config"],
    handler: Registration["handler"]
  ): void {
    this.tools.set(name, { config, handler });
  }
}

function setup(
  execute: ToolExecutor,
  options: { readOnly?: boolean } = {}
): FakeServer {
  const server = new FakeServer();
  registerMcpTools({
    server,
    coordinator: {
      execute: (name, input) => execute({ name, input }),
      launchBrowser: async ({ headless }) => ({
        alreadyRunning: false,
        headless: headless ?? true,
        source: "launched",
      }),
    },
    createInputSchema: (inputSchema) => inputSchema,
    readOnly: options.readOnly,
  });
  return server;
}

describe("registerMcpTools", () => {
  it("registers launch_browser plus every canonical tool", () => {
    const server = setup(async () => ({ success: true }));
    expect([...server.tools.keys()]).toEqual([
      "launch_browser",
      ...getToolDefinitions().map((tool) => tool.name),
    ]);
  });

  it("uses the registry read-only policy", () => {
    const server = setup(async () => ({ success: true }), { readOnly: true });
    expect([...server.tools.keys()]).toEqual([
      "launch_browser",
      ...getToolDefinitions({ readOnly: true }).map((tool) => tool.name),
    ]);
    expect(server.tools.has("evaluate")).toBe(false);
    expect(server.tools.has("switch_tab")).toBe(true);
  });

  it("forwards tool calls to the canonical executor", async () => {
    const execute = jest.fn().mockResolvedValue({
      success: true,
      data: [{ id: "tab-1" }],
    });
    const server = setup(execute);

    const result = await server.tools.get("list_tabs")!.handler({});

    expect(execute).toHaveBeenCalledWith({ name: "list_tabs", input: {} });
    expect(result).toEqual({
      content: [
        { type: "text", text: '[\n  {\n    "id": "tab-1"\n  }\n]' },
      ],
    });
  });

  it("marks executor failures with isError", async () => {
    const server = setup(async () => ({
      success: false,
      error: "No active page",
    }));

    const result = await server.tools.get("get_state")!.handler({});

    expect(result).toEqual({
      content: [{ type: "text", text: "No active page" }],
      isError: true,
    });
  });

  it("converts screenshot data to MCP image content", async () => {
    const server = setup(async () => ({ success: true, data: "cG5n" }));

    const result = await server.tools.get("screenshot")!.handler({});

    expect(result).toEqual({
      content: [{ type: "image", data: "cG5n", mimeType: "image/png" }],
    });
  });

  it("launches through the coordinator and reports headful mode", async () => {
    const server = setup(async () => ({ success: true }));

    const result = await server.tools
      .get("launch_browser")!
      .handler({ headless: false });

    expect(result).toEqual({
      content: [{ type: "text", text: "Browser launched (headful)." }],
    });
  });
});

const mcpRuntime = await (async () => {
  try {
    const [serverModule, clientModule, memoryModule, typesModule, zodModule] =
      await Promise.all([
        import("@modelcontextprotocol/sdk/server/mcp.js"),
        import("@modelcontextprotocol/sdk/client/index.js"),
        import("@modelcontextprotocol/sdk/inMemory.js"),
        import("@modelcontextprotocol/sdk/types.js"),
        import("zod"),
      ]);
    return {
      McpServer: serverModule.McpServer,
      Client: clientModule.Client,
      InMemoryTransport: memoryModule.InMemoryTransport,
      CallToolResultSchema: typesModule.CallToolResultSchema,
      ListToolsResultSchema: typesModule.ListToolsResultSchema,
      z: zodModule.z,
    };
  } catch {
    return null;
  }
})();

describe.skipIf(mcpRuntime === null)("MCP SDK argument handling", () => {
  async function connectedClient() {
    const runtime = mcpRuntime!;
    const server = new runtime.McpServer({
      name: "tidesurf-test",
      version: "0.0.0",
    });
    registerMcpTools({
      server: server as unknown as McpServerLike,
      coordinator: {
        execute: async (name, input) => ({
          success: true,
          data: { name, input },
        }),
        launchBrowser: async () => ({
          alreadyRunning: false,
          headless: true,
          source: "launched" as const,
        }),
      },
      createInputSchema: createZodInputSchemaFactory(runtime.z),
    });
    const [clientTransport, serverTransport] =
      runtime.InMemoryTransport.createLinkedPair();
    const client = new runtime.Client({ name: "probe", version: "0.0.0" });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    return {
      client,
      close: async () => {
        await client.close();
        await server.close();
      },
    };
  }

  it("accepts tools/call with an omitted arguments key", async () => {
    const { client, close } = await connectedClient();
    try {
      const result = await client.request(
        { method: "tools/call", params: { name: "list_tabs" } },
        mcpRuntime!.CallToolResultSchema
      );

      expect(result.isError).toBeUndefined();
      const [content] = result.content as Array<{ type: string; text: string }>;
      expect(content.type).toBe("text");
      expect(JSON.parse(content.text)).toEqual({ name: "list_tabs", input: {} });
    } finally {
      await close();
    }
  });

  it("still rejects invalid arguments through schema validation", async () => {
    const { client, close } = await connectedClient();
    try {
      const result = await client.request(
        {
          method: "tools/call",
          params: { name: "navigate", arguments: { url: 42 } },
        },
        mcpRuntime!.CallToolResultSchema
      );

      expect(result.isError).toBe(true);
      const [content] = result.content as Array<{ type: string; text: string }>;
      expect(content.text).toContain("Input validation error");
    } finally {
      await close();
    }
  });

  it("keeps advertising full input schemas in tools/list", async () => {
    const { client, close } = await connectedClient();
    try {
      const result = await client.request(
        { method: "tools/list", params: {} },
        mcpRuntime!.ListToolsResultSchema
      );

      const navigate = result.tools.find(
        (tool: { name: string }) => tool.name === "navigate"
      ) as { inputSchema: { properties: Record<string, unknown>; required?: string[] } };
      expect(navigate.inputSchema.properties).toHaveProperty("url");
      expect(navigate.inputSchema.required).toEqual(["url"]);
    } finally {
      await close();
    }
  });
});
