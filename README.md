<img src="https://tidesurf.org/logo.svg" width="180" height="48" alt="TideSurf">

# TideSurf

**The live page. Agents surfing.**

[Website](https://tidesurf.org) · [Docs](https://tidesurf.org/docs) · [llms.txt](https://tidesurf.org/llms.txt) · [npm](https://www.npmjs.com/package/@tidesurf/core) · [Sponsor](https://github.com/sponsors/MercuriusDream)

TideSurf turns live Chromium into compact, model-readable text. Usable elements receive short IDs tied to the real page, giving an agent a direct read, choose, act loop through the Chrome DevTools Protocol.

## Start

```sh
bun add @tidesurf/core
```

```ts
import { TideSurf } from "@tidesurf/core";

const browser = await TideSurf.launch();
await browser.navigate("https://example.com");

const state = await browser.getState();
console.log(state.content);

const page = browser.getPage();
await page.click("B1");
await browser.close();
```

The page comes back as plain text with live handles:

```text
# Example Search
> example.com/search
NAV
  [L1](/) Home
  [L2](/about) About
FORM F1
  I1 ~Search... ="TideSurf"
  [B1] Search
```

`B1` points to the real Search button. Links, inputs, tabs, and forms keep the same compact relationship to the live page. CSS classes, wrapper markup, scripts, and decorative DOM stay out of the model context.

The live benchmark compresses GitHub from 84,236 estimated tokens to 2,593. Page structure changes the result; run `bun scripts/benchmark-live.ts` for a local measurement.

## Use it

`getState()` supports viewport filtering, `full`, `interactive`, and `minimal` output modes, plus a `maxTokens` budget. TideSurf also provides tab control, file boundaries, typed errors, read-only mode, and 18 standard tools for LLM function calling. The package supports Bun and Node.js 18+.

Read-only mode removes write and sensitive tools from the agent surface:

```ts
const browser = await TideSurf.launch({ readOnly: true });
```

Run TideSurf as an MCP server:

```sh
bunx tidesurf mcp --auto-connect
```

Chrome 144+ requires remote debugging approval at `chrome://inspect#remote-debugging`. TideSurf can launch Chromium or attach to a session already listening on port `9222`.

Continue with [Getting started](https://tidesurf.org/docs#getting-started), [Page format](https://tidesurf.org/docs#page-format), [Security](https://tidesurf.org/docs#security), or the [API reference](https://tidesurf.org/docs#api-reference).

[English](README.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Apache 2.0](LICENSE)
