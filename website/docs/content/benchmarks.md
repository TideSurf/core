# Benchmarks

TideSurf compresses the live DOM into token-efficient text. The compression ratio depends on how bloated the source HTML is — heavy sites with deep nesting, SVGs, and generated CSS classes see the biggest gains.

## Live-site results

These numbers come from `scripts/benchmark-live.ts`, which launches headless Chrome, navigates to real-world sites, and compares the full rendered DOM against TideSurf's compressed output.

| Site | Raw HTML | TideSurf | Reduction | Ratio | Parse time |
|------|----------|----------|-----------|-------|------------|
| GitHub | 84,236 tokens | 2,593 tokens | 97% | **32x** | 22ms |
| Wikipedia | 123,623 tokens | 12,097 tokens | 90% | **10x** | 63ms |
| MDN Docs | 24,925 tokens | 1,793 tokens | 93% | **14x** | 18ms |
| Hacker News | 8,706 tokens | 1,038 tokens | 88% | **8.4x** | 14ms |

**Average: 92% reduction, ~29ms parse time.**

## Understanding the numbers

### Why compression varies

The compression ratio depends on the structure of the source HTML:

- **Very high compression (10–32x):** Sites like GitHub and Wikipedia have deeply nested DOM trees, inline SVGs, auto-generated class names, wrapper `<div>`s, and embedded scripts/styles. TideSurf strips all of this while preserving every element losslessly.

- **High compression (8–14x):** Sites like MDN and Hacker News have moderate structural overhead. Text truncation, URL compression, and the compact output format combine for significant gains even on leaner pages.

### What gets removed

TideSurf's DOM walker discards:

- All `<script>` and `<style>` elements
- CSS class names and inline styles
- Wrapper/layout `<div>`s with no semantic meaning
- SVG icons and decorative elements
- Hidden elements (`display: none`, `aria-hidden`)
- Comment nodes and processing instructions

### What gets preserved

- **Interactive elements** — links, buttons, inputs, selects (assigned `L`/`B`/`I`/`S` IDs)
- **Visible text content** — headings, paragraphs, labels, table cells
- **Semantic structure** — `<nav>`, `<main>`, `<article>`, `<form>`, `<table>`
- **Element hierarchy** — enough nesting to understand the page layout

## Cost impact

Token costs at typical LLM pricing ($5/M input tokens):

| Site | Raw HTML cost | TideSurf cost | Savings per page |
|------|---------------|---------------|------------------|
| GitHub | $0.42 | $0.01 | $0.41 |
| Wikipedia | $0.62 | $0.06 | $0.56 |
| MDN Docs | $0.12 | $0.009 | $0.12 |

For an agent that browses 100 pages per session, TideSurf can reduce input costs by **88–97%**.

## Context window impact

Most LLMs have context windows of 128K–200K tokens. A single raw GitHub page (84,236 tokens) uses **42–66%** of the context window. With TideSurf (2,593 tokens), the same page uses **1–2%** — leaving room for the agent's instructions, conversation history, and dozens of additional pages in a single session.

## Running benchmarks yourself

```bash
# Live-site benchmark (requires Chrome)
bun scripts/benchmark-live.ts

# Unit-level compression benchmarks
bun run test:bench
```

The live benchmark tests 8 sites by default. Edit the `SITES` array in `scripts/benchmark-live.ts` to add your own. Unit-level compression benchmarks serve trusted local HTTP fixtures so navigation follows the same URL policy as normal browser sessions.

## Methodology

- **Browser:** Headless Chrome via CDP (same as production usage)
- **Token estimation:** `cl100k_base`-approximate character-based estimator (4 chars ≈ 1 token)
- **Raw HTML:** `document.documentElement.outerHTML` after full page load
- **TideSurf output:** `getState().content` with default settings (no token budget limit)
- **Parse time:** Wall-clock time for `getState()` call only (excludes navigation)

Results will vary based on page content at the time of measurement. Sites with dynamic content (Reddit, HN) may show different numbers on each run.
