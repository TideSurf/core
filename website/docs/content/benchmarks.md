# Benchmarks

TideSurf compresses the live DOM into model-readable text. Deep nesting, SVGs, and generated CSS usually produce the largest reductions.

## Live-site results

`scripts/benchmark-live.ts` loads real sites in headless Chrome and compares the rendered DOM with TideSurf output.

| Site | Raw HTML | TideSurf | Reduction | Ratio | Parse time |
|------|----------|----------|-----------|-------|------------|
| GitHub | 84,236 tokens | 2,593 tokens | 97% | **32x** | 22ms |
| Wikipedia | 123,623 tokens | 12,097 tokens | 90% | **10x** | 63ms |
| MDN Docs | 24,925 tokens | 1,793 tokens | 93% | **14x** | 18ms |
| Hacker News | 8,706 tokens | 1,038 tokens | 88% | **8.4x** | 14ms |

**Average: 92% reduction, ~29ms parse time.**

## Understanding the numbers

Compression follows page structure:

- **10–32x:** GitHub and Wikipedia carry deep trees, inline SVG, generated classes, wrappers, and embedded scripts or styles.
- **8–14x:** MDN and Hacker News carry less structural overhead, but text truncation, URL compression, and the compact format still remove substantial weight.

The DOM walker removes scripts, styles, CSS classes, layout wrappers, decorative SVG, hidden elements, comments, and processing instructions. It keeps controls with short IDs, visible copy, semantic containers, tables, and enough hierarchy to understand the page.

## Cost impact

Token costs at typical LLM pricing ($5/M input tokens):

| Site | Raw HTML cost | TideSurf cost | Savings per page |
|------|---------------|---------------|------------------|
| GitHub | $0.42 | $0.01 | $0.41 |
| Wikipedia | $0.62 | $0.06 | $0.56 |
| MDN Docs | $0.12 | $0.009 | $0.12 |

A 100-page session can reduce input cost by **88–97%**.

## Context window impact

Across a 128K–200K context window, the raw GitHub page uses **42–66%**. TideSurf output uses **1–2%**, leaving room for instructions, conversation history, and more pages.

## Running benchmarks yourself

```bash
# Live-site benchmark (requires Chrome)
bun scripts/benchmark-live.ts

# Unit-level compression benchmarks
bun run test:bench
```

The live benchmark covers eight sites by default. Add targets through the `SITES` array. Unit benchmarks use trusted local HTTP fixtures under the normal navigation policy.

## Methodology

- **Browser:** Headless Chrome via CDP (same as production usage)
- **Token estimation:** `cl100k_base`-approximate character-based estimator (4 chars ≈ 1 token)
- **Raw HTML:** `document.documentElement.outerHTML` after full page load
- **TideSurf output:** `getState().content` with default settings (no token budget limit)
- **Parse time:** Wall-clock time for `getState()` call only (excludes navigation)

Results vary with live page content, especially on dynamic sites such as Reddit and Hacker News.
