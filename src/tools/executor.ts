import type { TideSurf } from "../tidesurf.js";
import type { ToolResult } from "../types.js";
import {
  validateElementId,
  validateSelector,
  validateExpression,
  validateSearchQuery,
  validatePositiveInteger,
  validatePositiveNumber,
} from "../validation.js";

interface ToolInput {
  name: string;
  input: Record<string, unknown>;
}

const READ_ONLY_DISABLED_TOOLS = new Set([
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
      if (readOnly && READ_ONLY_DISABLED_TOOLS.has(tool.name)) {
        return {
          success: false,
          error: `Tool "${tool.name}" is disabled in read-only mode`,
        };
      }

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
          // HIGH-007: Input validation
          if (maxTokens !== undefined) {
            validatePositiveInteger(maxTokens, "maxTokens");
          }
          const state = await instance.getState({ maxTokens, viewport, mode, includeHidden });
          return { success: true, data: state.content };
        }
        case "navigate": {
          const url = tool.input["url"];
          if (typeof url !== "string") {
            throw new Error("URL is required and must be a string");
          }
          await instance.navigate(url);
          const state = await instance.getState();
          return { success: true, data: state.content };
        }
        case "click": {
          const id = tool.input["id"];
          if (typeof id !== "string") {
            throw new Error("Element ID is required and must be a string");
          }
          validateElementId(id);
          const page = instance.getPage();
          await page.click(id);
          const state = await instance.getState();
          return {
            success: true,
            data: `Clicked ${id}. Page state after click:\n\n${state.content}`,
          };
        }
        case "type": {
          const id = tool.input["id"];
          const text = tool.input["text"];
          if (typeof id !== "string") {
            throw new Error("Element ID is required and must be a string");
          }
          if (typeof text !== "string") {
            throw new Error("Text is required and must be a string");
          }
          validateElementId(id);
          const clear = (tool.input["clear"] as boolean) ?? false;
          const page = instance.getPage();
          await page.type(id, text, clear);
          return {
            success: true,
            data: `Typed "${text}" into ${id}${clear ? " (field cleared first)" : ""}. Call get_state to see the updated page, or call click on a submit button to proceed.`,
          };
        }
        case "select": {
          const id = tool.input["id"];
          const value = tool.input["value"];
          if (typeof id !== "string") {
            throw new Error("Element ID is required and must be a string");
          }
          if (typeof value !== "string") {
            throw new Error("Value is required and must be a string");
          }
          validateElementId(id);
          const page = instance.getPage();
          await page.select(id, value);
          return {
            success: true,
            data: `Selected "${value}" in ${id}. Call get_state to see the updated page if the selection triggers a change.`,
          };
        }
        case "scroll": {
          const direction = tool.input["direction"];
          if (direction !== "up" && direction !== "down") {
            throw new Error("Direction must be 'up' or 'down'");
          }
          const amount = tool.input["amount"] as number | undefined;
          if (amount !== undefined) {
            validatePositiveNumber(amount, "amount");
          }
          const page = instance.getPage();
          await page.scroll(direction, amount);
          const state = await instance.getState();
          return {
            success: true,
            data: `Scrolled ${direction}. Page state after scroll:\n\n${state.content}`,
          };
        }
        case "extract": {
          const selector = tool.input["selector"];
          if (typeof selector !== "string") {
            throw new Error("Selector is required and must be a string");
          }
          validateSelector(selector);
          const page = instance.getPage();
          const text = await page.extract(selector);
          return { success: true, data: text };
        }
        case "evaluate": {
          const expression = tool.input["expression"];
          if (typeof expression !== "string") {
            throw new Error("Expression is required and must be a string");
          }
          validateExpression(expression);
          const page = instance.getPage();
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
          if (url !== undefined && typeof url !== "string") {
            throw new Error("URL must be a string");
          }
          const tab = await instance.newTab(url);
          return { success: true, data: tab };
        }
        case "switch_tab": {
          const tabId = tool.input["tabId"];
          if (typeof tabId !== "string") {
            throw new Error("tabId is required and must be a string");
          }
          await instance.switchTab(tabId);
          const state = await instance.getState();
          return {
            success: true,
            data: `Switched to tab ${tabId}. Page state:\n\n${state.content}`,
          };
        }
        case "close_tab": {
          const tabId = tool.input["tabId"];
          if (typeof tabId !== "string") {
            throw new Error("tabId is required and must be a string");
          }
          await instance.closeTab(tabId);
          const tabs = await instance.listTabs();
          return {
            success: true,
            data: `Closed tab ${tabId}. Remaining tabs:\n${JSON.stringify(tabs, null, 2)}`,
          };
        }
        // New tools
        case "search": {
          const query = tool.input["query"];
          if (typeof query !== "string") {
            throw new Error("Query is required and must be a string");
          }
          validateSearchQuery(query);
          const maxResults = tool.input["maxResults"] as number | undefined;
          if (maxResults !== undefined) {
            validatePositiveInteger(maxResults, "maxResults");
          }
          const page = instance.getPage();
          const results = await page.search(query, maxResults);
          return { success: true, data: results };
        }
        case "screenshot": {
          const elementId = tool.input["elementId"] as string | undefined;
          const fullPage = tool.input["fullPage"] as boolean | undefined;
          if (elementId !== undefined && typeof elementId !== "string") {
            throw new Error("elementId must be a string");
          }
          if (elementId) {
            validateElementId(elementId);
          }
          const page = instance.getPage();
          const base64 = await page.screenshot({ elementId, fullPage });
          return { success: true, data: base64 };
        }
        case "upload": {
          const id = tool.input["id"];
          const filePath = tool.input["filePath"];
          if (typeof id !== "string") {
            throw new Error("Element ID is required and must be a string");
          }
          if (typeof filePath !== "string") {
            throw new Error("filePath is required and must be a string");
          }
          validateElementId(id);
          const page = instance.getPage();
          await page.upload(id, [filePath]);
          return {
            success: true,
            data: `Uploaded file "${filePath}" to ${id}. Call get_state to see the updated page.`,
          };
        }
        case "clipboard_read": {
          const page = instance.getPage();
          const text = await page.clipboardRead();
          return { success: true, data: text };
        }
        case "clipboard_write": {
          const text = tool.input["text"];
          if (typeof text !== "string") {
            throw new Error("Text is required and must be a string");
          }
          const page = instance.getPage();
          await page.clipboardWrite(text);
          return {
            success: true,
            data: `Clipboard updated with: "${text.length > 200 ? text.slice(0, 200) + "..." : text}"`,
          };
        }
        case "download": {
          const id = tool.input["id"];
          if (typeof id !== "string") {
            throw new Error("Element ID is required and must be a string");
          }
          validateElementId(id);
          const downloadDir = tool.input["downloadDir"] as string | undefined;
          const timeout = tool.input["timeout"] as number | undefined;
          if (timeout !== undefined) {
            validatePositiveInteger(timeout, "timeout");
          }
          const page = instance.getPage();
          const result = await page.download(id, { downloadDir, timeout });
          return { success: true, data: result };
        }
        default:
          return { success: false, error: `Unknown tool: ${tool.name}. Available tools: get_state, navigate, click, type, select, scroll, extract, evaluate, list_tabs, new_tab, switch_tab, close_tab, search, screenshot, upload, clipboard_read, clipboard_write, download.` };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const errorType = err instanceof Error ? err.name : "UnknownError";
      const stack = process.env.NODE_ENV === "development" && err instanceof Error ? err.stack : undefined;

      // Log errors in development for debugging (fixes MED-002: Silent error swallowing)
      if (process.env.NODE_ENV === "development") {
        console.error(`[TideSurf Tool Error] ${tool.name}:`, err);
      }

      // Provide actionable error guidance based on error type
      if (err instanceof Error && err.name === "ElementNotFoundError") {
        return {
          success: false,
          error: `${message}. The element ID may have changed — call get_state to see the current page and its available element IDs (L=link, B=button, I=input, S=select), then retry with the correct ID.`,
          errorType,
          stack,
        };
      }

      if (/element.*not found|no element|invalid.*id/i.test(message)) {
        return {
          success: false,
          error: `${message}. The element ID may have changed — call get_state to see the current page and its available element IDs (L=link, B=button, I=input, S=select), then retry with the correct ID.`,
          errorType,
          stack,
        };
      }

      if (/timeout|timed out/i.test(message)) {
        return {
          success: false,
          error: `${message}. The page may still be loading. Call get_state to check the current state, or retry the operation.`,
          errorType,
          stack,
        };
      }

      if (/chrome|browser|connect|ECONNREFUSED|CDP|launch/i.test(message)) {
        return {
          success: false,
          error: `${message}. Make sure Chrome is installed and, if using auto-connect, that remote debugging is enabled at chrome://inspect#remote-debugging.`,
          errorType,
          stack,
        };
      }

      return { 
        success: false, 
        error: `${message}. Call get_state to see the current page state and determine how to proceed.`,
        errorType,
        stack,
      };
    }
  };
}
