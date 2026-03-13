#!/usr/bin/env node
/**
 * TideSurf CLI
 *
 * Usage:
 *   tidesurf-core inspect <url> [--max-tokens N] [--headful]
 *   tidesurf-core mcp [--headful]
 *   tidesurf-core --help
 */

import { TideSurf } from "./index.js";

const args = process.argv.slice(2);

function printUsage() {
  console.log(`tidesurf-core — DOM compression for LLM agents

Usage:
  tidesurf-core inspect <url> [options]   Navigate to a URL and print compressed XML
  tidesurf-core mcp [options]             Start the MCP server over stdio
  tidesurf-core --help                    Show this help

Options:
  --max-tokens <n>   Token budget for inspect output (default: unlimited)
  --headful          Launch Chrome with a visible window

Examples:
  tidesurf-core inspect https://example.com
  tidesurf-core inspect https://example.com --max-tokens 500
  tidesurf-core mcp --headful`);
}

function parseFlag(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

const hasFlag = (flag: string) => args.includes(flag);

async function inspect() {
  const url = args[1];
  if (!url) {
    console.error("Error: missing URL. Usage: tidesurf-core inspect <url>");
    process.exit(1);
  }

  const headful = hasFlag("--headful");
  const maxTokensStr = parseFlag("--max-tokens");
  const maxTokens = maxTokensStr ? parseInt(maxTokensStr, 10) : undefined;

  if (maxTokensStr && (isNaN(maxTokens!) || maxTokens! <= 0)) {
    console.error("Error: --max-tokens must be a positive integer");
    process.exit(1);
  }

  const browser = await TideSurf.launch({ headless: !headful });
  try {
    await browser.navigate(url);
    const state = await browser.getState(maxTokens ? { maxTokens } : undefined);
    console.log(state.xml);
  } finally {
    await browser.close();
  }
}

async function mcp() {
  const headful = hasFlag("--headful");

  // Dynamic imports — these are optionalDependencies, so we give a friendly error if missing.
  // Use variable specifiers to prevent TypeScript from resolving these at compile time.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mcpMod: any, stdioMod: any, zodMod: any;
  const mcpPath = "@modelcontextprotocol/sdk/server/mcp.js";
  const stdioPath = "@modelcontextprotocol/sdk/server/stdio.js";
  const zodPath = "zod";

  try {
    mcpMod = await import(mcpPath);
    stdioMod = await import(stdioPath);
    zodMod = await import(zodPath);
  } catch {
    console.error(
      "Error: MCP dependencies not found.\n\n" +
      "Install them with:\n" +
      "  npm install @modelcontextprotocol/sdk zod\n\n" +
      "Or use the standalone MCP adapter:\n" +
      "  bun mcp/index.ts"
    );
    process.exit(1);
  }

  const McpServer = mcpMod.McpServer;
  const StdioServerTransport = stdioMod.StdioServerTransport;
  const z = zodMod.z;

  let surfing: TideSurf | null = null;

  async function browser(): Promise<TideSurf> {
    if (!surfing) {
      console.error(`[tidesurf] Launching browser (${headful ? "headful" : "headless"})...`);
      surfing = await TideSurf.launch({ headless: !headful });
      console.error("[tidesurf] Browser ready.");
    }
    return surfing;
  }

  function text(t: string) {
    return { content: [{ type: "text" as const, text: t }] };
  }

  const server = new McpServer({ name: "tidesurf", version: "0.1.0" });

  // --- Page tools ---

  server.registerTool("get_state", {
    description: "Get the current page as compressed XML. Interactive elements have IDs (L=link, B=button, I=input, S=select) for use with click/type/select.",
    inputSchema: { maxTokens: z.number().optional().describe("Token budget — prunes low-priority elements to fit") },
  }, async ({ maxTokens }: { maxTokens?: number }) => {
    const s = await browser();
    const state = await s.getState(maxTokens ? { maxTokens } : undefined);
    return text(state.xml);
  });

  server.registerTool("navigate", {
    description: "Navigate the browser to a URL and return the new page state.",
    inputSchema: { url: z.string().describe("The URL to navigate to") },
  }, async ({ url }: { url: string }) => {
    const s = await browser();
    await s.navigate(url);
    const state = await s.getState();
    return text(state.xml);
  });

  server.registerTool("click", {
    description: "Click an interactive element by its ID (e.g. B1 for button, L3 for link).",
    inputSchema: { id: z.string().describe("Element ID from get_state (e.g. B1, L3, I2)") },
  }, async ({ id }: { id: string }) => {
    const page = (await browser()).getPage();
    await page.click(id);
    return text(`Clicked ${id}`);
  });

  server.registerTool("type", {
    description: "Type text into an input field by its ID.",
    inputSchema: {
      id: z.string().describe("Input element ID (e.g. I1)"),
      text: z.string().describe("Text to type"),
      clear: z.boolean().optional().describe("Clear the field first (default: false)"),
    },
  }, async ({ id, text: t, clear }: { id: string; text: string; clear?: boolean }) => {
    const page = (await browser()).getPage();
    await page.type(id, t, clear ?? false);
    return text(`Typed into ${id}`);
  });

  server.registerTool("select", {
    description: "Select an option in a dropdown by its ID and value.",
    inputSchema: {
      id: z.string().describe("Select element ID (e.g. S1)"),
      value: z.string().describe("Option value to select"),
    },
  }, async ({ id, value }: { id: string; value: string }) => {
    const page = (await browser()).getPage();
    await page.select(id, value);
    return text(`Selected ${value} in ${id}`);
  });

  server.registerTool("scroll", {
    description: "Scroll the page up or down.",
    inputSchema: {
      direction: z.enum(["up", "down"]).describe("Scroll direction"),
      amount: z.number().optional().describe("Pixels to scroll (default: 500)"),
    },
  }, async ({ direction, amount }: { direction: "up" | "down"; amount?: number }) => {
    const page = (await browser()).getPage();
    await page.scroll(direction, amount);
    return text(`Scrolled ${direction}`);
  });

  server.registerTool("extract", {
    description: "Extract text content from the page using a CSS selector.",
    inputSchema: { selector: z.string().describe("CSS selector") },
  }, async ({ selector }: { selector: string }) => {
    const page = (await browser()).getPage();
    const t = await page.extract(selector);
    return text(t);
  });

  server.registerTool("evaluate", {
    description: "Execute JavaScript in the page and return the result.",
    inputSchema: { expression: z.string().describe("JavaScript expression to evaluate") },
  }, async ({ expression }: { expression: string }) => {
    const page = (await browser()).getPage();
    const result = await page.evaluate(expression);
    return text(String(result));
  });

  // --- Tab tools ---

  server.registerTool("list_tabs", {
    description: "List all open browser tabs.",
    inputSchema: {},
  }, async () => {
    const tabs = await (await browser()).listTabs();
    return text(JSON.stringify(tabs, null, 2));
  });

  server.registerTool("new_tab", {
    description: "Open a new browser tab, optionally navigating to a URL.",
    inputSchema: { url: z.string().optional().describe("URL to open in new tab") },
  }, async ({ url }: { url?: string }) => {
    const tab = await (await browser()).newTab(url);
    return text(JSON.stringify(tab));
  });

  server.registerTool("switch_tab", {
    description: "Switch to a different browser tab by its ID.",
    inputSchema: { tabId: z.string().describe("Tab ID from list_tabs") },
  }, async ({ tabId }: { tabId: string }) => {
    await (await browser()).switchTab(tabId);
    return text(`Switched to tab ${tabId}`);
  });

  server.registerTool("close_tab", {
    description: "Close a browser tab by its ID.",
    inputSchema: { tabId: z.string().describe("Tab ID from list_tabs") },
  }, async ({ tabId }: { tabId: string }) => {
    await (await browser()).closeTab(tabId);
    return text(`Closed tab ${tabId}`);
  });

  // --- Lifecycle ---

  const transport = new StdioServerTransport();

  const shutdown = async () => {
    if (surfing) await surfing.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await server.connect(transport);
  console.error("[tidesurf] MCP server running on stdio");
}

// --- Main dispatch ---

const command = args[0];

if (!command || command === "--help" || command === "-h") {
  printUsage();
  process.exit(0);
}

switch (command) {
  case "inspect":
    inspect().catch((err) => {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
    break;
  case "mcp":
    mcp().catch((err) => {
      console.error(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
    break;
  default:
    console.error(`Unknown command: ${command}\n`);
    printUsage();
    process.exit(1);
}
