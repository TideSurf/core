#!/usr/bin/env bun
/**
 * TideSurf MCP Adapter
 *
 * Thin adapter that wraps the TideSurf SDK as an MCP server.
 * Exposes all browser tools as native MCP tools over stdio.
 *
 * Usage:
 *   bun mcp/index.ts [--headful] [--auto-connect] [--port 9222]
 *
 * Configure in .mcp.json:
 *   { "mcpServers": { "tidesurf": { "command": "bun", "args": ["mcp/index.ts", "--headful"] } } }
 *
 * To connect to an already-running Chrome instance:
 *   { "mcpServers": { "tidesurf": { "command": "bun", "args": ["mcp/index.ts", "--auto-connect"] } } }
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { TideSurf } from "../src/index.js";

const headful = process.argv.includes("--headful");
const autoConnect = process.argv.includes("--auto-connect");

function parsePort(): number | undefined {
  const idx = process.argv.indexOf("--port");
  if (idx === -1) return undefined;
  const raw = process.argv[idx + 1];
  if (raw === undefined) {
    console.error("[tidesurf-mcp] Error: --port requires a value");
    process.exit(1);
  }
  const n = parseInt(raw, 10);
  if (isNaN(n) || !Number.isInteger(n) || n < 1 || n > 65535) {
    console.error("[tidesurf-mcp] Error: --port must be an integer between 1 and 65535");
    process.exit(1);
  }
  return n;
}
const port = parsePort();

if (autoConnect && headful) {
  console.error("[tidesurf-mcp] Warning: --headful is ignored with --auto-connect (connecting to existing browser)");
}

// Lazy browser launch — only starts on first tool call
let surfing: TideSurf | null = null;

async function browser(): Promise<TideSurf> {
  if (!surfing) {
    if (autoConnect) {
      console.error(`[tidesurf-mcp] Connecting to running Chrome (port ${port ?? 9222})...`);
      surfing = await TideSurf.connect({ port });
      console.error("[tidesurf-mcp] Connected to existing browser.");
    } else {
      console.error(`[tidesurf-mcp] Launching browser (${headful ? "headful" : "headless"})...`);
      surfing = await TideSurf.launch({ headless: !headful, port });
      console.error("[tidesurf-mcp] Browser ready.");
    }
  }
  return surfing;
}

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}

// --- Server ---

const server = new McpServer({
  name: "tidesurf",
  version: "0.1.0",
});

// --- Page tools ---

server.registerTool(
  "get_state",
  {
    description:
      "Get the current page as compressed XML. Interactive elements have IDs (L=link, B=button, I=input, S=select) for use with click/type/select.",
    inputSchema: {
      maxTokens: z.number().optional().describe("Token budget — prunes low-priority elements to fit"),
    },
  },
  async ({ maxTokens }) => {
    const s = await browser();
    const state = await s.getState(maxTokens ? { maxTokens } : undefined);
    return text(state.xml);
  }
);

server.registerTool(
  "navigate",
  {
    description: "Navigate the browser to a URL and return the new page state.",
    inputSchema: {
      url: z.string().describe("The URL to navigate to"),
    },
  },
  async ({ url }) => {
    const s = await browser();
    await s.navigate(url);
    const state = await s.getState();
    return text(state.xml);
  }
);

server.registerTool(
  "click",
  {
    description:
      "Click an interactive element by its ID (e.g. B1 for button, L3 for link). Call get_state first to see available IDs.",
    inputSchema: {
      id: z.string().describe("Element ID from get_state (e.g. B1, L3, I2)"),
    },
  },
  async ({ id }) => {
    const page = (await browser()).getPage();
    await page.click(id);
    return text(`Clicked ${id}`);
  }
);

server.registerTool(
  "type",
  {
    description: "Type text into an input field by its ID.",
    inputSchema: {
      id: z.string().describe("Input element ID (e.g. I1)"),
      text: z.string().describe("Text to type"),
      clear: z.boolean().optional().describe("Clear the field first (default: false)"),
    },
  },
  async ({ id, text: t, clear }) => {
    const page = (await browser()).getPage();
    await page.type(id, t, clear ?? false);
    return text(`Typed into ${id}`);
  }
);

server.registerTool(
  "select",
  {
    description: "Select an option in a dropdown by its ID and value.",
    inputSchema: {
      id: z.string().describe("Select element ID (e.g. S1)"),
      value: z.string().describe("Option value to select"),
    },
  },
  async ({ id, value }) => {
    const page = (await browser()).getPage();
    await page.select(id, value);
    return text(`Selected ${value} in ${id}`);
  }
);

server.registerTool(
  "scroll",
  {
    description: "Scroll the page up or down.",
    inputSchema: {
      direction: z.enum(["up", "down"]).describe("Scroll direction"),
      amount: z.number().optional().describe("Pixels to scroll (default: 500)"),
    },
  },
  async ({ direction, amount }) => {
    const page = (await browser()).getPage();
    await page.scroll(direction, amount);
    return text(`Scrolled ${direction}`);
  }
);

server.registerTool(
  "extract",
  {
    description: "Extract text content from the page using a CSS selector.",
    inputSchema: {
      selector: z.string().describe("CSS selector"),
    },
  },
  async ({ selector }) => {
    const page = (await browser()).getPage();
    const t = await page.extract(selector);
    return text(t);
  }
);

server.registerTool(
  "evaluate",
  {
    description: "Execute JavaScript in the page and return the result.",
    inputSchema: {
      expression: z.string().describe("JavaScript expression to evaluate"),
    },
  },
  async ({ expression }) => {
    const page = (await browser()).getPage();
    const result = await page.evaluate(expression);
    return text(String(result));
  }
);

// --- Tab tools ---

server.registerTool(
  "list_tabs",
  {
    description: "List all open browser tabs.",
    inputSchema: {},
  },
  async () => {
    const tabs = await (await browser()).listTabs();
    return text(JSON.stringify(tabs, null, 2));
  }
);

server.registerTool(
  "new_tab",
  {
    description: "Open a new browser tab, optionally navigating to a URL.",
    inputSchema: {
      url: z.string().optional().describe("URL to open in new tab"),
    },
  },
  async ({ url }) => {
    const tab = await (await browser()).newTab(url);
    return text(JSON.stringify(tab));
  }
);

server.registerTool(
  "switch_tab",
  {
    description: "Switch to a different browser tab by its ID.",
    inputSchema: {
      tabId: z.string().describe("Tab ID from list_tabs"),
    },
  },
  async ({ tabId }) => {
    await (await browser()).switchTab(tabId);
    return text(`Switched to tab ${tabId}`);
  }
);

server.registerTool(
  "close_tab",
  {
    description: "Close a browser tab by its ID.",
    inputSchema: {
      tabId: z.string().describe("Tab ID from list_tabs"),
    },
  },
  async ({ tabId }) => {
    await (await browser()).closeTab(tabId);
    return text(`Closed tab ${tabId}`);
  }
);

// --- Lifecycle ---

async function main() {
  const transport = new StdioServerTransport();

  const shutdown = async () => {
    if (surfing) await surfing.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await server.connect(transport);
  console.error("[tidesurf-mcp] MCP server running on stdio");
}

main().catch((err) => {
  console.error("[tidesurf-mcp] Fatal:", err);
  process.exit(1);
});
