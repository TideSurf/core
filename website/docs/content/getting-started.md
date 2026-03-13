# Getting started

*In the modern web era, the tide is strong. Let's surf.*

TideSurf is the connector between Chromium and LLM agents — it translates the live DOM into minimal, token-efficient XML that any language model can understand (typically 100–800 tokens instead of 5,000–50,000+ for raw HTML), and translates agent actions back into browser commands via the Chrome DevTools Protocol.

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
console.log(state.xml);

// Execute agent actions using the element IDs from the XML
const page = browser.getPage();
await page.click("B1");        // Click the first button
await page.type("I1", "hello world");  // Type into the first input

await browser.close();
```

The `state.xml` output is a clean XML document that strips away all CSS classes, wrapper divs, scripts, and styles — keeping only interactive elements (buttons, links, inputs), semantic structure (nav, form, headings), and visible text content, each tagged with a short ID like `B1`, `L3`, or `I2` that your agent can reference when performing actions.

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

The `getToolDefinitions()` function returns an array of 12 tool schemas (navigate, click, type, scroll, extract, and more) formatted for LLM function calling. You can pass these directly to the Anthropic API, OpenAI API, or any other provider that supports tool use.

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

Once configured, all 12 TideSurf tools become available as MCP tools that your AI assistant can invoke directly.

## What to read next

- **[Page format](#page-format)** — understand the XML schema TideSurf produces and how element IDs work
- **[Token budget](#token-budget)** — control output size with `maxTokens` and learn how TideSurf prioritizes content
- **[API reference](#api-reference)** — full method signatures and tool definitions
