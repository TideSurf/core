import type { TideSurf } from "../tidesurf.js";
import type { ToolResult } from "../types.js";

interface ToolInput {
  name: string;
  input: Record<string, unknown>;
}

/**
 * Create a tool executor bound to an TideSurf instance.
 * Handles all tools including tab management.
 */
export function createToolExecutor(instance: TideSurf) {
  return async (tool: ToolInput): Promise<ToolResult> => {
    try {
      const page = instance.getPage();

      switch (tool.name) {
        case "get_state": {
          const maxTokens = tool.input["maxTokens"] as number | undefined;
          const state = await instance.getState(maxTokens ? { maxTokens } : undefined);
          return { success: true, data: state.xml };
        }
        case "navigate": {
          const url = tool.input["url"] as string;
          await page.navigate(url);
          const state = await instance.getState();
          return { success: true, data: state.xml };
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
        default:
          return { success: false, error: `Unknown tool: ${tool.name}` };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  };
}
