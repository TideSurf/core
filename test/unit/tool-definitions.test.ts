import {
  TOOL_REGISTRY,
  createToolExecutor,
  getToolDefinitions,
  getToolSpec,
} from "../../src/tools/registry.js";
import { ActionCommittedError } from "../../src/errors.js";
import type { TideSurf } from "../../src/tidesurf.js";

describe("getToolDefinitions", () => {
  it("returns 18 tools by default", () => {
    const tools = getToolDefinitions();
    expect(tools).toHaveLength(18);
  });

  it("every tool has name, description, and input_schema", () => {
    const tools = getToolDefinitions();
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.input_schema.type).toBe("object");
      expect(tool.input_schema.properties).toBeDefined();
    }
  });

  it("returns 6 tools in read-only mode", () => {
    const tools = getToolDefinitions({ readOnly: true });
    expect(tools).toHaveLength(6);
  });

  it("read-only mode excludes all write tools", () => {
    const writeToolNames = [
      "navigate",
      "click",
      "type",
      "select",
      "scroll",
      "new_tab",
      "close_tab",
      "upload",
      "clipboard_read",
      "clipboard_write",
      "download",
    ];
    const tools = getToolDefinitions({ readOnly: true });
    const names = tools.map((t) => t.name);
    for (const writeTool of writeToolNames) {
      expect(names).not.toContain(writeTool);
    }
  });

  it("read-only mode includes read tools", () => {
    const expectedReadTools = [
      "get_state",
      "extract",
      "list_tabs",
      "switch_tab",
      "search",
      "screenshot",
    ];
    const tools = getToolDefinitions({ readOnly: true });
    const names = tools.map((t) => t.name);
    for (const readTool of expectedReadTools) {
      expect(names).toContain(readTool);
    }
  });

  it("full mode includes all write tools", () => {
    const writeToolNames = [
      "navigate",
      "click",
      "type",
      "select",
      "scroll",
      "evaluate",
      "new_tab",
      "close_tab",
      "upload",
      "clipboard_write",
      "download",
    ];
    const tools = getToolDefinitions();
    const names = tools.map((t) => t.name);
    for (const writeTool of writeToolNames) {
      expect(names).toContain(writeTool);
    }
  });

  it("tool names are unique", () => {
    const tools = getToolDefinitions();
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("derives definitions and CLI discovery from the same registry", () => {
    expect(getToolDefinitions().map((tool) => tool.name)).toEqual(
      TOOL_REGISTRY.map((tool) => tool.name)
    );

    for (const tool of TOOL_REGISTRY) {
      expect(getToolSpec(tool.name)).toBe(tool);
    }
  });

  it("exposes CLI metadata and output kinds for every tool", () => {
    for (const tool of TOOL_REGISTRY) {
      expect(["text", "json", "image"]).toContain(tool.outputKind);
      expect(tool.cli.positionals).toBeDefined();
      expect(tool.cli.options).toBeDefined();
    }

    expect(getToolSpec("get_state")?.name).toBe("get_state");
    expect(getToolSpec("clipboard_read")?.name).toBe("clipboard_read");
  });

  it("does not expose mutable canonical schemas", () => {
    const first = getToolDefinitions();
    first[0].input_schema.properties["injected"] = { type: "string" };
    expect(getToolDefinitions()[0].input_schema.properties["injected"]).toBeUndefined();
    expect(TOOL_REGISTRY[0].inputSchema.properties["injected"]).toBeUndefined();
  });

  it("reports committed mutations as success so agents do not retry them", async () => {
    const instance = {
      isReadOnly: () => false,
      getPage: () => ({
        click: async () => {
          throw new ActionCommittedError("Click", new Error("stability timeout"));
        },
      }),
      getUrlValidationOptions: () => ({}),
    } as unknown as TideSurf;

    const result = await createToolExecutor(instance)({
      name: "click",
      input: { id: "B1" },
    });

    expect(result.success).toBe(true);
    expect(result.data).toContain("Click completed");
    expect(result.data).toContain("Read the page again");
  });
});
