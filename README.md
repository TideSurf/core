<p align="center">
  <img src="https://tidesurf.org/logo.svg" width="80" height="80" alt="TideSurf">
</p>

<h2 align="center">
    TideSurf
</h2>

<p align="center">
    <strong>English</strong> | <a href="README.ja.md">日本語</a> | <a href="README.ko.md">한국語</a>
</p>

<p align="center">
  <strong><a href="https://tidesurf.org">About</a></strong> |
  <strong><a href="https://tidesurf.org/docs">Documentation</a></strong> |
  <strong><a href="https://tidesurf.org/llms.txt">llms.txt</a></strong>
</p>

<p align="center">
  <a href="https://www.producthunt.com/products/tidesurf?embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-tidesurf" target="_blank" rel="noopener noreferrer"><img alt="TideSurf - Ultra-token-efficient CDP library for AI agents | Product Hunt" width="250" height="54" src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1101853&theme=neutral&t=1773855834160" /></a>
</p>

---

TideSurf is a TypeScript library that connects Chromium to LLM agents via the Chrome DevTools Protocol (CDP). It walks the live DOM, compresses it into a token-efficient structured representation (50-200 tokens per page), and exposes 18 tool definitions for LLM function calling. No screenshots, no vision models -- just DOM compression that keeps token costs 10-100x lower than screenshot-based approaches.

## Installation

```bash
npm install @tidesurf/core
# or
bun add @tidesurf/core
```

Requires Chrome/Chromium installed locally (auto-detected, or set `CHROME_PATH`).

## Quick Start

```typescript
import { TideSurf } from "@tidesurf/core";

// Launch Chrome and navigate
const browser = await TideSurf.launch();
await browser.navigate("https://example.com");

// Get compressed page state (50-200 tokens)
const state = await browser.getState();
console.log(state.content);

// Interact with elements using their IDs (L=link, B=button, I=input, S=select)
const page = browser.getPage();
await page.click("L1");
await page.type("I1", "search query", true);

await browser.close();
```

## CLI Usage

TideSurf ships with a CLI for quick inspection and MCP server mode.

```bash
# Inspect a page — prints compressed DOM to stdout
npx @tidesurf/core inspect https://example.com

# Start the MCP server for Claude Code integration
npx @tidesurf/core mcp
```

## MCP Integration

Add TideSurf as an MCP server in your Claude Code configuration (`.mcp.json`):

```json
{
  "mcpServers": {
    "tidesurf": {
      "command": "npx",
      "args": ["-y", "@tidesurf/core", "mcp"]
    }
  }
}
```

Once configured, all 18 TideSurf tools become available as MCP tools that your AI assistant can invoke directly.

## Read-Only Mode

```typescript
const browser = await TideSurf.connect({ readOnly: true });
// Agent can observe, search, and screenshot — but cannot click, type, or navigate
```

## Documentation

- **[Getting started](https://tidesurf.org/docs#getting-started)** -- installation, first steps, and output modes
- **[Page format](https://tidesurf.org/docs#page-format)** -- understand the compressed DOM output and element IDs
- **[Token budget](https://tidesurf.org/docs#token-budget)** -- control output size with `maxTokens`
- **[Agent patterns](https://tidesurf.org/docs#agent-patterns)** -- real-world agent loop examples
- **[Security](https://tidesurf.org/docs#security)** -- read-only mode, input validation, and CDP security
- **[API reference](https://tidesurf.org/docs#api-reference)** -- full method signatures and tool definitions

---

<p align="center">
  <img src="https://tidesurf.org/og.png" alt="TideSurf Social Preview">
</p>

<p align="center">
  <a href="https://github.com/TideSurf/core/actions/workflows/ci.yml"><img src="https://github.com/TideSurf/core/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/@tidesurf/core"><img src="https://img.shields.io/npm/v/@tidesurf/core" alt="npm"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="License"></a>
</p>
