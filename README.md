# TideSurf

**English** | [日本語](README.ja.md) | [한국어](README.ko.md)

[![CI](https://github.com/tidesurf/@tidesurf/core/actions/workflows/ci.yml/badge.svg)](https://github.com/tidesurf/@tidesurf/core/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@tidesurf/core)](https://www.npmjs.com/package/@tidesurf/core)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

**The connector between Chromium and LLM agents — no screenshots, no vision models, just the DOM compressed for machines.**

TideSurf translates the live DOM into a minimal, token-efficient XML that any LLM can consume (100–800 tokens vs 5,000–50,000+ for raw HTML), and translates agent actions back into browser commands via CDP.

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

## Documentation

Full docs at **[docs.tidesurf.org](https://docs.tidesurf.org)**:

- [Getting started](https://docs.tidesurf.org/#getting-started) — installation, quick start, LLM integration
- [Page format](https://docs.tidesurf.org/#page-format) — how DOM compression works
- [Token budget](https://docs.tidesurf.org/#token-budget) — controlling output size
- [Multi-tab](https://docs.tidesurf.org/#multi-tab) — managing browser tabs
- [Error handling](https://docs.tidesurf.org/#error-handling) — typed errors and retry behavior
- [API reference](https://docs.tidesurf.org/#api-reference) — full class and tool reference
- [Architecture](https://docs.tidesurf.org/#architecture) — how TideSurf fits in

## License

Apache 2.0
