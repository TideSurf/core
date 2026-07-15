# Benchmarks

TideSurf compresses the live DOM into model-readable text. Deep nesting, SVGs, and generated CSS usually produce the largest reductions.

## Reproducible fixture results

`bun run test:bench` serves fixed local fixtures and runs the production parser in headless Chrome. The current representative results are:

| Fixture | Source HTML | Rendered DOM | TideSurf | Source reduction | Ratio |
|---|---:|---:|---:|---:|---:|
| E-commerce | 5,348 tokens | 5,336 tokens | 446 tokens | 92% | 12.0x |
| News | 4,807 tokens | 4,807 tokens | 395 tokens | 92% | 12.2x |

The token-budget regression also reduces the 446-token e-commerce state to 274 tokens with a 300-token target while retaining actionable IDs and visible omission markers.

## Understanding the numbers

Compression follows page structure:

- Deep trees, inline SVG, generated classes, wrappers, and embedded scripts or styles produce larger reductions.
- Text-heavy, shallow pages retain more source content and produce smaller reductions.

The DOM walker removes scripts, styles, CSS classes, layout wrappers, decorative SVG, hidden elements, comments, and processing instructions. It keeps controls with short IDs, visible copy, semantic containers, tables, and enough hierarchy to understand the page.

## Cost impact

At an illustrative $5 per million input tokens, cost follows this formula:

```text
estimated cost = input tokens / 1,000,000 × price per million tokens
```

Use the measured ratio for your pages and the current price of your selected model. TideSurf does not claim one reduction for every site.

## Context window impact

Compact state leaves more room for instructions, conversation history, and additional pages. The exact share depends on the selected model, page, viewport mode, and token budget.

## Running benchmarks yourself

```bash
# Volatile live-site diagnostic (requires Chrome and network access)
bun scripts/benchmark-live.ts

# Unit-level compression benchmarks
bun run test:bench
```

The live diagnostic covers eight sites by default. It uses `viewport: false` so offscreen visible content remains on the TideSurf side of the comparison. A sample is skipped when it is an interstitial or bot challenge, has fewer than 1,000 rendered tokens, has fewer than 100 TideSurf tokens, or has fewer than 3 action IDs. The summary divides total rendered tokens by total TideSurf tokens; it does not average per-site ratios. Live numbers change with page content and bot policy, so do not copy them into release claims without a dated rerun. Unit benchmarks use trusted local HTTP fixtures under the normal navigation policy.

## Methodology

- **Browser:** Headless Chrome via CDP (same as production usage)
- **Token estimation:** Four-character heuristic (≈4 characters per token); no model tokenizer runs
- **Raw HTML:** `document.documentElement.outerHTML` after full page load
- **TideSurf output:** `getState({ viewport: false }).content` with no token budget limit for the live full-page visible-state comparison; local acceptance tests exercise the production viewport default separately
- **Parse time:** Wall-clock time for `getState()` call only (excludes navigation)

Fixture results are deterministic for a given parser revision. Live results vary with content, geography, authentication, experiments, and anti-automation pages.
