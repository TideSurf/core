import type { TideSurf } from "../tidesurf.js";
import type { ToolResult } from "../types.js";

interface ToolInput {
  name: string;
  input: Record<string, unknown>;
}

const WRITE_TOOLS = new Set([
  "navigate",
  "click",
  "type",
  "select",
  "scroll",
  "evaluate",
  "new_tab",
  "close_tab",
  "upload",
  "clipboard_read",
  "clipboard_write",
  "download",
]);

/**
 * Create a tool executor bound to an TideSurf instance.
 * Handles all tools including tab management.
 */
export function createToolExecutor(
  instance: TideSurf,
  readOnly: boolean = false
) {
  return async (tool: ToolInput): Promise<ToolResult> => {
    try {
      if (readOnly && WRITE_TOOLS.has(tool.name)) {
        return {
          success: false,
          error: `Tool "${tool.name}" is disabled in read-only mode`,
        };
      }

      const page = instance.getPage();

      switch (tool.name) {
        case "get_state": {
          const maxTokens = tool.input["maxTokens"] as number | undefined;
          const viewport = tool.input["viewport"] as boolean | undefined;
          const mode = tool.input["mode"] as
            | "full"
            | "minimal"
            | "interactive"
            | undefined;
          const state = await instance.getState({ maxTokens, viewport, mode });
          return { success: true, data: state.content };
        }
        case "navigate": {
          const url = tool.input["url"] as string;
          await page.navigate(url);
          const state = await instance.getState();
          return { success: true, data: state.content };
        }
        case "click": {
          const id = tool.input["id"] as string;
          await page.click(id);
          return { success: true, data: `Clicked ${id}` };
        }
        case "type": {
          const id = tool.input["id"] as string;
          const text = tool.input["text"] as string;
          const clear = (tool.input["clear"] as boolean) ?? false;
          await page.type(id, text, clear);
          return { success: true, data: `Typed into ${id}` };
        }
        case "select": {
          const id = tool.input["id"] as string;
          const value = tool.input["value"] as string;
          await page.select(id, value);
          return { success: true, data: `Selected ${value} in ${id}` };
        }
        case "scroll": {
          const direction = tool.input["direction"] as "up" | "down";
          const amount = tool.input["amount"] as number | undefined;
          await page.scroll(direction, amount);
          return { success: true, data: `Scrolled ${direction}` };
        }
        case "extract": {
          const selector = tool.input["selector"] as string;
          const text = await page.extract(selector);
          return { success: true, data: text };
        }
        case "evaluate": {
          const expression = tool.input["expression"] as string;
          const result = await page.evaluate(expression);
          return { success: true, data: result };
        }
        // Tab management tools
        case "list_tabs": {
          const tabs = await instance.listTabs();
          return { success: true, data: tabs };
        }
        case "new_tab": {
          const url = tool.input["url"] as string | undefined;
          const tab = await instance.newTab(url);
          return { success: true, data: tab };
        }
        case "switch_tab": {
          const tabId = tool.input["tabId"] as string;
          await instance.switchTab(tabId);
          return { success: true, data: `Switched to tab ${tabId}` };
        }
        case "close_tab": {
          const tabId = tool.input["tabId"] as string;
          await instance.closeTab(tabId);
          return { success: true, data: `Closed tab ${tabId}` };
        }
        // New tools
        case "search": {
          const query = tool.input["query"] as string;
          const maxResults = tool.input["maxResults"] as number | undefined;
          const results = await page.search(query, maxResults);
          return { success: true, data: results };
        }
        case "screenshot": {
          const elementId = tool.input["elementId"] as string | undefined;
          const fullPage = tool.input["fullPage"] as boolean | undefined;
          const base64 = await page.screenshot({ elementId, fullPage });
          return { success: true, data: base64 };
        }
        case "upload": {
          const id = tool.input["id"] as string;
          const filePath = tool.input["filePath"] as string;
          await page.upload(id, [filePath]);
          return { success: true, data: `Uploaded to ${id}` };
        }
        case "clipboard_read": {
          const text = await page.clipboardRead();
          return { success: true, data: text };
        }
        case "clipboard_write": {
          const text = tool.input["text"] as string;
          await page.clipboardWrite(text);
          return { success: true, data: "Clipboard updated" };
        }
        case "download": {
          const id = tool.input["id"] as string;
          const downloadDir = tool.input["downloadDir"] as string | undefined;
          const timeout = tool.input["timeout"] as number | undefined;
          const result = await page.download(id, { downloadDir, timeout });
          return { success: true, data: result };
        }
        default:
          return { success: false, error: `Unknown tool: ${tool.name}` };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  };
}
