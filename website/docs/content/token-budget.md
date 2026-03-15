# Token budget

Complex web pages can produce output that's larger than what you want to send to your LLM, especially for token-constrained models or high-frequency agent loops where cost matters. The `maxTokens` parameter lets you set an upper bound on output size, and TideSurf will intelligently prune the page to fit within that budget.

## Setting a budget

Pass `maxTokens` to `getState()` to cap the output:

```typescript
const state = await browser.getState({ maxTokens: 500 });
```

If the full page output would exceed 500 tokens, TideSurf starts removing content — beginning with the least important elements — until the output fits within the budget.

## How TideSurf prioritizes content

When pruning is necessary, TideSurf uses a priority system that keeps the most actionable content and discards decorative or redundant elements first. The priority order, from highest (kept first) to lowest (pruned first):

1. **Interactive elements** — buttons, links, inputs, selects, and forms are always prioritized because they represent actions the agent can take
2. **Visible text content** — headings, paragraphs, and labels that help the agent understand the page context
3. **Semantic structure** — nav, section, and article containers that provide organizational cues
4. **Supplementary content** — secondary text, nested descriptions, and metadata that's useful but not essential
5. **Decorative elements** — elements that don't carry actionable or informational content

Within each priority tier, elements closer to the top of the page take precedence, since the beginning of a page typically contains the most relevant context (navigation, primary content area, main CTAs).

## Truncation indicator

When TideSurf removes elements to meet the token budget, it appends a truncation indicator at the end of the output so the LLM knows that additional content exists beyond what's shown:

```
# Example
> example.com

NAV
  [L1](/) Home
[B1] Sign up
[...12 more sections truncated]
```

The number indicates how many top-level sections were removed. This gives the agent the option to request a larger budget on the next call, or to scroll down and get a different view of the page.

## Choosing the right budget

The ideal token budget depends on your use case:

| Scenario | Suggested budget | Rationale |
|---|---|---|
| Quick navigation checks | 200–400 | Only need to see links and buttons for the next action |
| Form filling | 400–600 | Need to see inputs, labels, and submit buttons |
| Full page understanding | 600–1000 | Need headings, text content, and all interactive elements |
| No budget (default) | Unlimited | TideSurf returns the complete compressed page |

For agent loops with many iterations, starting with a lower budget (300–500 tokens) and increasing it only when the agent needs more context is a practical strategy that balances cost and capability.
