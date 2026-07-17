# Benchmarks

TideSurf compresses the live DOM into model-readable text. Deep nesting, SVGs, and generated CSS usually produce the largest reductions.

## Reproducible fixture results

`bun run test:bench` serves fixed local fixtures and runs the production parser in headless Chrome. The current representative results are:

| Fixture | Source HTML | Rendered DOM | TideSurf | Source reduction | Ratio |
|---|---:|---:|---:|---:|---:|
| E-commerce | 5,348 tokens | 5,336 tokens | 1,218 tokens | 77% | 4.4x |
| News | 4,807 tokens | 4,807 tokens | 1,127 tokens | 77% | 4.3x |

The token-budget regression also reduces the 1218-token e-commerce state to 254 tokens with a 300-token target while retaining actionable IDs and visible omission markers.

## Runtime guardrails

Executable performance tests exercise a 65,536-branch tree and a 10,000-element page. They check near-linear parser and pruning growth, bounded output, stable source order, and retained action IDs. These gates run production code rather than copied benchmark implementations.

The browser gate compares `readPage()` time at 2,500 and 10,000 elements in one process, interleaving measurement rounds so machine load hits both sides of the ratio. It rejects growth above 5.5x and keeps a 250 ms ceiling for the larger page, using per-size minima as the least-noise estimate of true cost.

A 10,000-button release profile showed where time is spent after the current cleanup:

| Stage | Mean time |
|---|---:|
| CDP snapshot capture | 50.5 ms |
| Snapshot decode | 8.0 ms |
| Semantic walk | 2.3 ms |
| Token pruning | 3.0 ms |
| Viewport filtering | 0.5 ms |
| Serialization | 0.3 ms |

The values are diagnostic, not a cross-machine promise. They show that browser capture and JSON decoding dominate this synthetic case; local filtering and serialization are already small. Compare changes on the same machine and Chrome build.

## Understanding the numbers

Compression follows page structure:

- Deep trees, inline SVG, generated classes, wrappers, and embedded scripts or styles produce larger reductions.
- Text-heavy, shallow pages retain more source content and produce smaller reductions.

One bounded, non-mutating node preflight precedes each `DOMSnapshot.captureSnapshot` request. Snapshot decoding removes scripts, styles, CSS classes, layout wrappers, decorative SVG, hidden elements, comments, and processing instructions. It keeps controls with short IDs, visible copy, semantic containers, tables, and enough hierarchy to understand the page. Paint-order obscuration is omitted instead of inferred from incomplete geometry.

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
- **Source HTML:** Fixed fixture source text for reproducible local results
- **Rendered DOM:** `document.documentElement.outerHTML` after full page load
- **TideSurf output:** `readPage({ viewport: false }).content` with no token budget limit for the live full-page visible-state comparison; local acceptance tests exercise the production viewport default separately
- **Parse time:** Wall-clock time for `readPage()` only (excludes navigation)
- **Capture path:** Bounded non-mutating node preflight, one `DOMSnapshot.captureSnapshot`, then local decode/filter/prune/serialize passes

Fixture results are deterministic for a given parser revision. Live results vary with content, geography, authentication, experiments, and anti-automation pages.
