# Benchmarks

TideSurf compresses the live DOM into token-efficient XML. The compression ratio depends on how bloated the source HTML is — heavy sites with deep nesting, SVGs, and generated CSS classes see the biggest gains.

## Live-site results

These numbers come from `scripts/benchmark-live.ts`, which launches headless Chrome, navigates to real-world sites, and compares the full rendered DOM against TideSurf's compressed XML output.

| Site | Raw HTML | TideSurf | Reduction | Ratio | Parse time |
|------|----------|----------|-----------|-------|------------|
| Wikipedia | 123,631 tokens | 25,189 tokens | 80% | **4.9x** | 60ms |
| GitHub | 84,668 tokens | 10,968 tokens | 87% | **7.7x** | 18ms |
| Reddit | 47,489 tokens | 21,972 tokens | 54% | **2.2x** | 7ms |
| MDN Docs | 24,919 tokens | 18,769 tokens | 25% | **1.3x** | 16ms |
| Hacker News | 8,694 tokens | 7,364 tokens | 15% | **1.2x** | 9ms |

**Average: 65% reduction, ~15ms parse time.**

## Understanding the numbers

### Why compression varies

The compression ratio depends on the structure of the source HTML:

- **High compression (4–8x):** Sites like GitHub and Wikipedia have deeply nested DOM trees, inline SVGs, auto-generated class names, wrapper `<div>`s, and embedded scripts/styles. TideSurf strips all of this, keeping only interactive elements and visible text.

- **Moderate compression (2–3x):** Sites like Reddit have a mix of structural overhead and actual content. Compression is solid but not extreme.

- **Low compression (1.2–1.5x):** Sites like Hacker News are already minimal — simple table-based layout with little CSS or scripting overhead. TideSurf still removes what it can, but there's less to strip.

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

Token costs at typical LLM pricing ($3/M input tokens):

| Site | Raw HTML cost | TideSurf cost | Savings per page |
|------|---------------|---------------|------------------|
| Wikipedia | $0.37 | $0.08 | $0.29 |
| GitHub | $0.25 | $0.03 | $0.22 |
| Reddit | $0.14 | $0.07 | $0.07 |

For an agent that browses 100 pages per session, TideSurf can reduce input costs by **60–85%**.

## Context window impact

Most LLMs have context windows of 128K–200K tokens. A single raw GitHub page (84,668 tokens) uses **42–66%** of the context window. With TideSurf (10,968 tokens), the same page uses **5–8%** — leaving room for the agent's instructions, conversation history, and dozens of additional pages.

## Running benchmarks yourself

```bash
# Live-site benchmark (requires Chrome)
bun scripts/benchmark-live.ts

# Unit-level compression benchmarks
bun run test:bench
```

The live benchmark tests 8 sites by default. Edit the `SITES` array in `scripts/benchmark-live.ts` to add your own.

## Methodology

- **Browser:** Headless Chrome via CDP (same as production usage)
- **Token estimation:** `cl100k_base`-approximate character-based estimator (4 chars ≈ 1 token)
- **Raw HTML:** `document.documentElement.outerHTML` after full page load
- **TideSurf output:** `getState().xml` with default settings (no token budget limit)
- **Parse time:** Wall-clock time for `getState()` call only (excludes navigation)

Results will vary based on page content at the time of measurement. Sites with dynamic content (Reddit, HN) may show different numbers on each run.
