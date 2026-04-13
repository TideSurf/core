import { getToolDefinitions } from "../../src/tools/definitions.js";

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

  it("returns 7 tools in read-only mode", () => {
    const tools = getToolDefinitions({ readOnly: true });
    expect(tools).toHaveLength(7);
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
      "clipboard_read",
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
});
