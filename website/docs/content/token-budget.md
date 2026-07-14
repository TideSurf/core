# Token budget

`maxTokens` caps page output for constrained models and frequent agent loops. TideSurf prunes lower-value content to meet the budget.

## Setting a budget

Pass the limit to `getState()`:

```typescript
const state = await browser.getState({ maxTokens: 500 });
```

Output above 500 tokens loses the least important content first.

## How TideSurf prioritizes content

The priority order runs from highest value to lowest:

1. **Controls:** buttons, links, inputs, selects, and forms
2. **Visible copy:** headings, paragraphs, and labels
3. **Structure:** navigation, sections, and articles
4. **Supporting copy:** descriptions and metadata
5. **Decoration:** content with no action or information

Earlier elements take precedence within each tier.

## Truncation indicator

Pruned output ends with a truncation indicator:

```
# Example
> example.com

NAV
  [L1](/) Home
[B1] Sign up
[...12 more sections truncated]
```

The count reports removed top-level sections. The agent can raise the budget or scroll for another view.

## Choosing the right budget

Choose a budget around the next task:

| Scenario | Suggested budget | Rationale |
|---|---|---|
| Quick navigation checks | 200-400 | Links and buttons for the next action |
| Form filling | 400-600 | Inputs, labels, and submission controls |
| Full page understanding | 600-1000 | Headings, copy, and all controls |
| No budget (default) | Unlimited | TideSurf returns the complete compressed page |

Long loops can start at 300–500 tokens and grow only as the agent needs more context.
