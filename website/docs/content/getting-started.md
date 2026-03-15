# Getting started

*In the modern web era, the tide is strong. Let's surf.*

TideSurf is the connector between Chromium and LLM agents — it translates the live DOM into minimal, token-efficient text that any language model can understand (typically 50–200 tokens instead of 5,000–50,000+ for raw HTML), and translates agent actions back into browser commands via the Chrome DevTools Protocol.

Special thanks to [SaltyAom](https://github.com/SaltyAom) and [ElysiaJS](https://elysiajs.com).

## Prerequisites

TideSurf requires a Chromium-based browser installed on the host machine. On most systems, Chrome or Chromium is already available, but you can point TideSurf to a specific binary by setting the `CHROME_PATH` environment variable or passing `chromePath` in the launch options.

**Runtime compatibility:**
- **Bun** (recommended) — TideSurf is built and tested against Bun
- **Node.js** ≥ 18 — fully supported via the same npm package

## Installation

```bash
# Bun (recommended)
bun add @tidesurf/core

# npm / yarn / pnpm
npm install @tidesurf/core
yarn add @tidesurf/core
pnpm add @tidesurf/core
```

## Quick start

The simplest way to use TideSurf is to launch a browser, navigate somewhere, and read the compressed page state:

```typescript
import { TideSurf } from "@tidesurf/core";

const browser = await TideSurf.launch();
await browser.navigate("https://example.com");

// Get compressed page state — this is what you feed to your LLM
const state = await browser.getState();
console.log(state.content);

// Execute agent actions using the element IDs from the output
const page = browser.getPage();
await page.click("B1");        // Click the first button
await page.type("I1", "hello world");  // Type into the first input

await browser.close();
```

The `state.content` output is compact text that strips away all CSS classes, wrapper divs, scripts, and styles — keeping only interactive elements (buttons, links, inputs), semantic structure (nav, form, headings), and visible text content, with short IDs like `B1`, `L3`, or `I2` that your agent can reference when performing actions.

## Connecting to an existing browser

Instead of launching a new Chrome instance, you can connect to one that's already running. This is useful when you want to:

- **Re-use a logged-in session** — your agent can access pages behind authentication without re-entering credentials
- **Debug a live page** — spot a bug while browsing, then hand off to your agent to investigate
- **Keep your browsing state** — extensions, cookies, and local storage carry over

```typescript
import { TideSurf } from "@tidesurf/core";

// Connect to Chrome running with remote debugging on port 9222
const browser = await TideSurf.connect();

// Everything works the same from here
const state = await browser.getState();
const page = browser.getPage();
await page.click("B1");

// close() only disconnects CDP — it won't kill your Chrome
await browser.close();
```

**Prerequisites:** Chrome must have remote debugging enabled. Either:

1. **Chrome 144+:** Open `chrome://inspect#remote-debugging` and enable it — Chrome will show a permission dialog when TideSurf connects
2. **Any Chrome:** Launch with `--remote-debugging-port=9222`

You can specify a custom port and host:

```typescript
const browser = await TideSurf.connect({
  port: 9333,
  host: "localhost",
  timeout: 15000,
});
```

Or from the CLI:

```bash
tidesurf inspect https://example.com --auto-connect --port 9333
tidesurf mcp --auto-connect
```

## Read-only mode

Launch or connect with `readOnly: true` to prevent the agent from modifying pages or accessing sensitive local state. Only observation tools (`get_state`, `extract`, `list_tabs`, `switch_tab`, `search`, `screenshot`) remain available. `evaluate` and `clipboard_read` are intentionally disabled in read-only mode.

```typescript
const browser = await TideSurf.launch({ readOnly: true });
// or
const browser = await TideSurf.connect({ readOnly: true });
```

From the CLI:
```bash
tidesurf mcp --read-only
tidesurf mcp --auto-connect --read-only
```

## Filesystem access

By default, TideSurf only allows `upload` and custom `downloadDir` paths inside the current working directory and the OS temp directory. Override that policy explicitly when you need a wider host filesystem boundary:

```typescript
const browser = await TideSurf.launch({
  fileAccessRoots: [process.cwd(), "/absolute/shared-fixtures"],
});
```

## Integrating with an LLM agent

TideSurf ships with standardized tool definitions that you can pass directly to any LLM that supports function calling. This makes it straightforward to build an autonomous browsing agent — your LLM receives the compressed page state as context, decides which tool to call, and TideSurf executes the action:

```typescript
import { TideSurf, getToolDefinitions } from "@tidesurf/core";

const surfing = await TideSurf.launch();
const tools = getToolDefinitions();   // Standard tool schemas for your LLM
const executor = surfing.getToolExecutor();

// In your agent loop:
const result = await executor({
  name: "navigate",
  input: { url: "https://example.com" },
});
```

The `getToolDefinitions()` function returns an array of 18 tool schemas (navigate, click, type, scroll, extract, and more) formatted for LLM function calling. You can pass these directly to the Anthropic API, OpenAI API, or any other provider that supports tool use.

## Using as an MCP server

If you're working with Claude Code or another MCP-compatible client, TideSurf can run as a Model Context Protocol server — no code required. Add the following to your MCP configuration:

```json
{
  "mcpServers": {
    "tidesurf": {
      "command": "bunx",
      "args": ["tidesurf", "mcp"]
    }
  }
}
```

To connect to your running Chrome instead of launching a headless instance, add `--auto-connect`:

```json
{
  "mcpServers": {
    "tidesurf": {
      "command": "bunx",
      "args": ["tidesurf", "mcp", "--auto-connect"]
    }
  }
}
```

Once configured, all 18 TideSurf tools become available as MCP tools that your AI assistant can invoke directly.

## Output modes

`getState` accepts a `mode` parameter for different levels of detail:

```typescript
// Full page (default)
const full = await browser.getState();

// Only interactive elements (buttons, links, inputs)
const interactive = await browser.getState({ mode: "interactive" });

// Landmarks and summaries only
const minimal = await browser.getState({ mode: "minimal" });

// Only what's visible in the viewport (this is now the default)
const viewport = await browser.getState(); // viewport defaults to true
```

Modes compose with each other and `maxTokens`.

## What to read next

- **[Page format](#page-format)** — understand the output format TideSurf produces and how element IDs work
- **[Token budget](#token-budget)** — control output size with `maxTokens` and learn how TideSurf prioritizes content
- **[API reference](#api-reference)** — full method signatures and tool definitions (including `TideSurf.connect()`)
