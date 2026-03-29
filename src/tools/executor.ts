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
          const includeHidden = tool.input["includeHidden"] as boolean | undefined;
          const state = await instance.getState({ maxTokens, viewport, mode, includeHidden });
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
          const state = await instance.getState();
          return {
            success: true,
            data: `Clicked ${id}. Page state after click:\n\n${state.content}`,
          };
        }
        case "type": {
          const id = tool.input["id"] as string;
          const text = tool.input["text"] as string;
          const clear = (tool.input["clear"] as boolean) ?? false;
          await page.type(id, text, clear);
          return {
            success: true,
            data: `Typed "${text}" into ${id}${clear ? " (field cleared first)" : ""}. Call get_state to see the updated page, or call click on a submit button to proceed.`,
          };
        }
        case "select": {
          const id = tool.input["id"] as string;
          const value = tool.input["value"] as string;
          await page.select(id, value);
          return {
            success: true,
            data: `Selected "${value}" in ${id}. Call get_state to see the updated page if the selection triggers a change.`,
          };
        }
        case "scroll": {
          const direction = tool.input["direction"] as "up" | "down";
          const amount = tool.input["amount"] as number | undefined;
          await page.scroll(direction, amount);
          const state = await instance.getState();
          return {
            success: true,
            data: `Scrolled ${direction}. Page state after scroll:\n\n${state.content}`,
          };
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
          const state = await instance.getState();
          return {
            success: true,
            data: `Switched to tab ${tabId}. Page state:\n\n${state.content}`,
          };
        }
        case "close_tab": {
          const tabId = tool.input["tabId"] as string;
          await instance.closeTab(tabId);
          const tabs = await instance.listTabs();
          return {
            success: true,
            data: `Closed tab ${tabId}. Remaining tabs:\n${JSON.stringify(tabs, null, 2)}`,
          };
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
          return {
            success: true,
            data: `Uploaded file "${filePath}" to ${id}. Call get_state to see the updated page.`,
          };
        }
        case "clipboard_read": {
          const text = await page.clipboardRead();
          return { success: true, data: text };
        }
        case "clipboard_write": {
          const text = tool.input["text"] as string;
          await page.clipboardWrite(text);
          return {
            success: true,
            data: `Clipboard updated with: "${text.length > 200 ? text.slice(0, 200) + "..." : text}"`,
          };
        }
        case "download": {
          const id = tool.input["id"] as string;
          const downloadDir = tool.input["downloadDir"] as string | undefined;
          const timeout = tool.input["timeout"] as number | undefined;
          const result = await page.download(id, { downloadDir, timeout });
          return { success: true, data: result };
        }
        default:
          return { success: false, error: `Unknown tool: ${tool.name}. Available tools: get_state, navigate, click, type, select, scroll, extract, evaluate, list_tabs, new_tab, switch_tab, close_tab, search, screenshot, upload, clipboard_read, clipboard_write, download.` };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      // Provide actionable error guidance
      if (/element.*not found|no element|invalid.*id/i.test(message)) {
        return {
          success: false,
          error: `${message}. The element ID may have changed — call get_state to see the current page and its available element IDs (L=link, B=button, I=input, S=select), then retry with the correct ID.`,
        };
      }

      if (/timeout|timed out/i.test(message)) {
        return {
          success: false,
          error: `${message}. The page may still be loading. Call get_state to check the current state, or retry the operation.`,
        };
      }

      if (/chrome|browser|connect|ECONNREFUSED|CDP|launch/i.test(message)) {
        return {
          success: false,
          error: `${message}. Make sure Chrome is installed and, if using auto-connect, that remote debugging is enabled at chrome://inspect#remote-debugging.`,
        };
      }

      return { success: false, error: `${message}. Call get_state to see the current page state and determine how to proceed.` };
    }
  };
}
