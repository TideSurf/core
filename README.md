<p align="center">
  <img src="assets/logo.svg" width="80" height="80" alt="TideSurf">
</p>

<h1 align="center">TideSurf</h1>

<p align="center"><strong>English</strong> | <a href="README.ja.md">日本語</a> | <a href="README.ko.md">한국어</a></p>

<p align="center">
  <a href="https://github.com/TideSurf/core/actions/workflows/ci.yml"><img src="https://github.com/TideSurf/core/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/@tidesurf/core"><img src="https://img.shields.io/npm/v/@tidesurf/core" alt="npm"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="License"></a>
</p>

<p align="center">
  <strong>The connector between Chromium and LLM agents —<br>no screenshots, no vision models, just the DOM compressed for machines.</strong>
</p>

<p align="center">
  TideSurf translates the live DOM into a minimal, token-efficient XML that any LLM can consume<br>
  (100–800 tokens vs 5,000–50,000+ for raw HTML), and translates agent actions back into browser commands via CDP.
</p>

<br>

## Installation

```bash
bun add @tidesurf/core
```

## Quick Start

```typescript
import { TideSurf } from "@tidesurf/core";

const browser = await TideSurf.launch();
await browser.navigate("https://example.com");

const state = await browser.getState();
console.log(state.xml);

const page = browser.getPage();
await page.click("B1");
await page.type("I1", "hello world");

await browser.close();
```

## Benchmarks

<p align="center">Real-world token compression measured against live sites:</p>

| Site | Raw HTML | TideSurf | Reduction | Ratio |
|------|----------|----------|-----------|-------|
| Wikipedia | 123,631 tokens | 25,189 tokens | 80% | **4.9x** |
| GitHub | 84,668 tokens | 10,968 tokens | 87% | **7.7x** |
| Reddit | 47,489 tokens | 21,972 tokens | 54% | **2.2x** |
| MDN Docs | 24,919 tokens | 18,769 tokens | 25% | **1.3x** |
| Hacker News | 8,694 tokens | 7,364 tokens | 15% | **1.2x** |

> Run `bun scripts/benchmark-live.ts` to reproduce.

## Documentation

<p align="center">
  Full docs at <strong><a href="https://tidesurf.org/docs">tidesurf.org/docs</a></strong>
</p>

- [Getting started](https://tidesurf.org/docs/#getting-started) — installation, quick start, LLM integration
- [Page format](https://tidesurf.org/docs/#page-format) — how DOM compression works
- [Token budget](https://tidesurf.org/docs/#token-budget) — controlling output size
- [Multi-tab](https://tidesurf.org/docs/#multi-tab) — managing browser tabs
- [Error handling](https://tidesurf.org/docs/#error-handling) — typed errors and retry behavior
- [API reference](https://tidesurf.org/docs/#api-reference) — full class and tool reference
- [Architecture](https://tidesurf.org/docs/#architecture) — how TideSurf fits in

## License

<p align="center">Apache 2.0</p>
