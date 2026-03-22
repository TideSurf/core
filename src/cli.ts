#!/usr/bin/env node
/**
 * TideSurf CLI
 *
 * Usage:
 *   tidesurf inspect <url> [--max-tokens N] [--headful]
 *   tidesurf mcp [--headful]
 *   tidesurf --help
 */

import { TideSurf } from "./index.js";
import { VERSION } from "./version.js";

const args = process.argv.slice(2);

function printUsage() {
  console.log(`tidesurf — DOM compression for LLM agents

Usage:
  tidesurf inspect <url> [options]   Navigate to a URL and print compressed DOM
  tidesurf mcp [options]             Start the MCP server over stdio
  tidesurf --help                    Show this help

Options:
  --max-tokens <n>   Token budget for inspect output (default: unlimited)
  --headful          Launch Chrome with a visible window
  --auto-connect     Connect to an already-running Chrome instance instead of
                     launching a new one. Requires remote debugging enabled in
                     Chrome (chrome://inspect#remote-debugging or --remote-debugging-port)
  --read-only        Disable mutating and unsafe tools (click, type, evaluate, upload, etc.)
  --port <n>         CDP port (default: 9222). Used with --auto-connect to specify
                     which port to connect on, or with launch to set the debug port

Examples:
  tidesurf inspect https://example.com
  tidesurf inspect https://example.com --max-tokens 500
  tidesurf mcp --headful
  tidesurf mcp --auto-connect
  tidesurf mcp --auto-connect --port 9333`);
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
    console.error("Error: missing URL. Usage: tidesurf inspect <url>");
    process.exit(1);
  }

  const headful = hasFlag("--headful");
  const autoConnect = hasFlag("--auto-connect");
  const readOnly = hasFlag("--read-only");
  const maxTokensStr = parseFlag("--max-tokens");
  const maxTokens = maxTokensStr ? parseInt(maxTokensStr, 10) : undefined;
  const portStr = parseFlag("--port");
  const port = portStr ? parseInt(portStr, 10) : undefined;

  if (maxTokensStr && (isNaN(maxTokens!) || maxTokens! <= 0)) {
    console.error("Error: --max-tokens must be a positive integer");
    process.exit(1);
  }

  if (portStr && (isNaN(port!) || !Number.isInteger(port!) || port! < 1 || port! > 65535)) {
    console.error("Error: --port must be an integer between 1 and 65535");
    process.exit(1);
  }

  if (autoConnect && headful) {
    console.error("Warning: --headful is ignored with --auto-connect (connecting to existing browser)");
  }

  const browser = autoConnect
    ? await TideSurf.connect({ port, readOnly })
    : await TideSurf.launch({ headless: !headful, port, readOnly });
  try {
    await browser.navigate(url);
    const state = await browser.getState(maxTokens ? { maxTokens } : undefined);
    console.log(state.content);
  } finally {
    await browser.close();
  }
}

async function mcp() {
  const headful = hasFlag("--headful");
  const autoConnect = hasFlag("--auto-connect");
  const readOnly = hasFlag("--read-only");
  const portStr = parseFlag("--port");
  const port = portStr ? parseInt(portStr, 10) : undefined;

  if (portStr && (isNaN(port!) || !Number.isInteger(port!) || port! < 1 || port! > 65535)) {
    console.error("Error: --port must be an integer between 1 and 65535");
    process.exit(1);
  }

  if (autoConnect && headful) {
    console.error("Warning: --headful is ignored with --auto-connect (connecting to existing browser)");
  }

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
      "  npm install @modelcontextprotocol/sdk zod"
    );
    process.exit(1);
  }

  const McpServer = mcpMod.McpServer;
  const StdioServerTransport = stdioMod.StdioServerTransport;
  const z = zodMod.z;

  let surfing: TideSurf | null = null;
  let headless = !headful;

  async function browser(): Promise<TideSurf> {
    if (!surfing) {
      if (autoConnect) {
        try {
          console.error(`[tidesurf] Connecting to running Chrome (port ${port ?? 9222})...`);
          surfing = await TideSurf.connect({ port, readOnly });
          console.error("[tidesurf] Connected to existing browser.");
        } catch {
          console.error("[tidesurf] No running Chrome found, launching a new instance...");
          surfing = await TideSurf.launch({ headless, port, readOnly });
          console.error("[tidesurf] Browser launched.");
        }
      } else {
        console.error(`[tidesurf] Launching browser (${headless ? "headless" : "headful"})...`);
        surfing = await TideSurf.launch({ headless, port, readOnly });
        console.error("[tidesurf] Browser ready.");
      }
    }
    return surfing;
  }

  function text(t: string) {
    return { content: [{ type: "text" as const, text: t }] };
  }

  const server = new McpServer({ name: "tidesurf", version: VERSION });

  // --- Browser lifecycle ---

  server.registerTool("launch_browser", {
    description: "Launch the browser. Call this before other tools if you need headful mode (visible browser window). If not called, the browser launches headless automatically on the first tool call.",
    inputSchema: {
      headless: z.boolean().optional().describe("Run headless (default: true). Set false to show the browser window."),
    },
  }, async ({ headless: hl }: { headless?: boolean }) => {
    if (surfing) {
      return text("Browser is already running.");
    }
    if (hl !== undefined) headless = hl;
    await browser();
    return text(`Browser launched (${headless ? "headless" : "headful"}).`);
  });

  // --- Page tools ---

  server.registerTool("get_state", {
    description: "Get the current page as compressed text. Interactive elements have IDs (L=link, B=button, I=input, S=select) for use with click/type/select.",
    inputSchema: {
      maxTokens: z.number().optional().describe("Token budget — prunes low-priority elements to fit"),
      viewport: z.boolean().optional().describe("Only include visible viewport elements"),
      mode: z.enum(["full", "minimal", "interactive"]).optional().describe("Output mode"),
    },
  }, async ({ maxTokens, viewport, mode }: { maxTokens?: number; viewport?: boolean; mode?: "full" | "minimal" | "interactive" }) => {
    const s = await browser();
    const state = await s.getState({
      ...(maxTokens ? { maxTokens } : {}),
      ...(viewport !== undefined ? { viewport } : {}),
      ...(mode ? { mode } : {}),
    });
    return text(state.content);
  });

  if (!readOnly) {
    server.registerTool("navigate", {
      description: "Navigate the browser to a URL and return the new page state.",
      inputSchema: { url: z.string().describe("The URL to navigate to") },
    }, async ({ url }: { url: string }) => {
      const s = await browser();
      await s.navigate(url);
      const state = await s.getState();
      return text(state.content);
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
  }

  server.registerTool("extract", {
    description: "Extract text content from the page using a CSS selector.",
    inputSchema: { selector: z.string().describe("CSS selector") },
  }, async ({ selector }: { selector: string }) => {
    const page = (await browser()).getPage();
    const t = await page.extract(selector);
    return text(t);
  });

  if (!readOnly) {
    server.registerTool("evaluate", {
      description: "Execute JavaScript in the page and return the result.",
      inputSchema: { expression: z.string().describe("JavaScript expression to evaluate") },
    }, async ({ expression }: { expression: string }) => {
      const page = (await browser()).getPage();
      const result = await page.evaluate(expression);
      return text(String(result));
    });
  }

  // --- Tab tools ---

  server.registerTool("list_tabs", {
    description: "List all open browser tabs.",
    inputSchema: {},
  }, async () => {
    const tabs = await (await browser()).listTabs();
    return text(JSON.stringify(tabs, null, 2));
  });

  if (!readOnly) {
    server.registerTool("new_tab", {
      description: "Open a new browser tab, optionally navigating to a URL.",
      inputSchema: { url: z.string().optional().describe("URL to open in new tab") },
    }, async ({ url }: { url?: string }) => {
      const tab = await (await browser()).newTab(url);
      return text(JSON.stringify(tab));
    });
  }

  server.registerTool("switch_tab", {
    description: "Switch to a different browser tab by its ID.",
    inputSchema: { tabId: z.string().describe("Tab ID from list_tabs") },
  }, async ({ tabId }: { tabId: string }) => {
    await (await browser()).switchTab(tabId);
    return text(`Switched to tab ${tabId}`);
  });

  if (!readOnly) {
    server.registerTool("close_tab", {
      description: "Close a browser tab by its ID.",
      inputSchema: { tabId: z.string().describe("Tab ID from list_tabs") },
    }, async ({ tabId }: { tabId: string }) => {
      await (await browser()).closeTab(tabId);
      return text(`Closed tab ${tabId}`);
    });
  }

  // --- Search / Screenshot ---

  server.registerTool("search", {
    description: "Search for text on the page. Returns matches with snippets, tag names, match indices, and nearest interactive element IDs when available.",
    inputSchema: {
      query: z.string().describe("Text to search for (case-insensitive)"),
      maxResults: z.number().optional().describe("Max matches to return (default: 10)"),
    },
  }, async ({ query, maxResults }: { query: string; maxResults?: number }) => {
    const page = (await browser()).getPage();
    const results = await page.search(query, maxResults);
    return text(JSON.stringify(results, null, 2));
  });

  server.registerTool("screenshot", {
    description: "Capture a screenshot of the page or a specific element. Returns base64 PNG.",
    inputSchema: {
      elementId: z.string().optional().describe("Element ID to capture (default: viewport)"),
      fullPage: z.boolean().optional().describe("Capture the entire scrollable page"),
    },
  }, async ({ elementId, fullPage }: { elementId?: string; fullPage?: boolean }) => {
    const page = (await browser()).getPage();
    const base64 = await page.screenshot({ elementId, fullPage });
    return { content: [{ type: "image" as const, data: base64, mimeType: "image/png" }] };
  });

  // --- Write and sensitive tools (skipped in read-only mode) ---

  if (!readOnly) {
    server.registerTool("clipboard_read", {
      description: "Read the current clipboard contents.",
      inputSchema: {},
    }, async () => {
      const page = (await browser()).getPage();
      const t = await page.clipboardRead();
      return text(t);
    });

    server.registerTool("upload", {
      description: "Upload a file to a file input element.",
      inputSchema: {
        id: z.string().describe("File input element ID (e.g. I1)"),
        filePath: z.string().describe("Path to the file to upload"),
      },
    }, async ({ id, filePath }: { id: string; filePath: string }) => {
      const page = (await browser()).getPage();
      await page.upload(id, [filePath]);
      return text(`Uploaded to ${id}`);
    });

    server.registerTool("clipboard_write", {
      description: "Write text to the clipboard.",
      inputSchema: {
        text: z.string().describe("Text to write to clipboard"),
      },
    }, async ({ text: t }: { text: string }) => {
      const page = (await browser()).getPage();
      await page.clipboardWrite(t);
      return text("Clipboard updated");
    });

    server.registerTool("download", {
      description: "Click a download link/button and capture the downloaded file.",
      inputSchema: {
        id: z.string().describe("Element ID of the download link/button"),
        downloadDir: z.string().optional().describe("Directory to save to (default: temp dir)"),
        timeout: z.number().optional().describe("Max wait time in ms (default: 30000)"),
      },
    }, async ({ id, downloadDir, timeout }: { id: string; downloadDir?: string; timeout?: number }) => {
      const page = (await browser()).getPage();
      const result = await page.download(id, { downloadDir, timeout });
      return text(JSON.stringify(result));
    });
  }

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
