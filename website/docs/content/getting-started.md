# Getting started

TideSurf connects Chromium to LLM agents. It turns the live DOM into compact, model-readable text and sends model actions back through the Chrome DevTools Protocol. Thanks to [SaltyAom](https://github.com/SaltyAom) and [ElysiaJS](https://elysiajs.com).

## Prerequisites

Install a Chromium-based browser and use Bun or Node.js 18+. TideSurf finds common Chrome and Chromium installs automatically. Set `CHROME_PATH` or pass `chromePath` to use another binary.

## Installation

```bash
bun add @tidesurf/core
# or: npm install @tidesurf/core
# or: yarn add @tidesurf/core
# or: pnpm add @tidesurf/core
```

Chrome 144+ also needs remote debugging approval. Open `chrome://inspect#remote-debugging` and enable **Allow remote debugging for this browser instance**.

## Quick start

Launch, navigate, read, and act:

```typescript
import { TideSurf } from "@tidesurf/core";

const browser = await TideSurf.launch();
await browser.navigate("https://example.com");

const state = await browser.getState();
console.log(state.content);

const page = browser.getPage();
await page.click("B1");
await page.type("I1", "hello world");

await browser.close();
```

Send `state.content` to the model. TideSurf removes styles, scripts, and wrapper markup while keeping visible copy, structure, and usable controls. Short IDs such as `B1`, `L3`, and `I2` remain tied to the live page. Disabled or inert controls appear in `~~strikethrough~~`. [Page format](#page-format) documents the full representation.

## Connecting to an existing browser

Attach to an open Chrome session to reuse cookies, extensions, login state, and the page already under inspection:

```typescript
import { TideSurf } from "@tidesurf/core";

const browser = await TideSurf.connect();
const state = await browser.getState();
const page = browser.getPage();
await page.click("B1");

// Disconnects CDP without closing your Chrome process.
await browser.close();
```

Chrome must expose a remote debugging port. Chrome 144+ uses `chrome://inspect#remote-debugging`; any supported Chrome can launch with `--remote-debugging-port=9222`. Custom hosts, ports, and timeouts are explicit:

```typescript
const browser = await TideSurf.connect({
  port: 9333,
  host: "localhost",
  timeout: 15000,
});
```

```bash
tidesurf inspect https://example.com --auto-connect --port 9333
tidesurf mcp --auto-connect
```

## Read-only mode

Read-only sessions expose observation tools only: `get_state`, `extract`, `list_tabs`, `switch_tab`, `search`, and `screenshot`. Mutation, clipboard, evaluation, file, and tab-creation tools stay unavailable.

```typescript
const browser = await TideSurf.launch({ readOnly: true });
// or: await TideSurf.connect({ readOnly: true })
```

```bash
tidesurf mcp --read-only
tidesurf mcp --auto-connect --read-only
```

## Filesystem access

Uploads and custom download paths stay inside the current working directory and OS temp directory by default. Expand the boundary explicitly:

```typescript
const browser = await TideSurf.launch({
  fileAccessRoots: [process.cwd(), "/absolute/shared-fixtures"],
});
```

## Integrating with an LLM agent

`getToolDefinitions()` returns 18 provider-neutral function schemas. The executor accepts the model's selected tool call:

```typescript
import { TideSurf, getToolDefinitions } from "@tidesurf/core";

const browser = await TideSurf.launch();
const tools = getToolDefinitions();
const executor = browser.getToolExecutor();

const result = await executor({
  name: "navigate",
  input: { url: "https://example.com" },
});
```

The schemas work with Anthropic, OpenAI, and other providers that support function calling.

## Using as an MCP server

Add TideSurf to an MCP client:

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

Remove `--auto-connect` to launch a separate headless browser.

## Output modes

Choose the amount of page detail needed for the next action:

```typescript
const full = await browser.getState();
const interactive = await browser.getState({ mode: "interactive" });
const minimal = await browser.getState({ mode: "minimal" });
const fullPage = await browser.getState({ viewport: false });
const bounded = await browser.getState({ maxTokens: 500 });
```

Viewport filtering is on by default. Modes compose with `viewport` and `maxTokens`.

## What to read next

[Page format](#page-format) explains the text and IDs. [Token budget](#token-budget) covers output limits. [Security](#security) defines the trust boundary. [API reference](#api-reference) lists every method and tool. [Migration](#migration) tracks breaking changes.
