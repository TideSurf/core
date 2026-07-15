# Token budget

`maxTokens` sets an approximate target for constrained models and frequent agent loops. TideSurf prunes lower-value body content before serialization. The page header, metadata, escaping, and truncation markers can put final output slightly above the target.

## Setting a budget

Pass the limit to `readPage()`:

```typescript
const state = await browser.readPage({ maxTokens: 500 });
```

Body content above the target loses lower-priority nodes first. The estimator uses four characters per token; it does not run a model-specific tokenizer.

## How TideSurf prioritizes content

The pruning pass ranks sibling subtrees in this order:

1. **Actionable subtrees:** content containing current interaction IDs
2. **Viewport-marked subtrees:** content with more visible nodes
3. **Compact content:** shorter text when action and visibility scores tie
4. **Source order:** earlier siblings when all other scores tie

Oversized containers are pruned recursively, so useful children can survive even when their parent does not fit unchanged. Unchanged subtrees retain source order.

## Truncation indicators

When the target has room for it, pruned output emits an indicator at each sibling list where sections were omitted:

```
# Example
> example.com

NAV
  [L1](/) Home
[B1] Sign up
[...12 more sections truncated]
```

The count reports removed siblings at that point in the tree. Nested pruning can produce more than one indicator, and controls such as selects retain an indicator when their options are pruned. The agent can raise the target or scroll for another viewport.

## Choosing the right budget

Choose a budget around the next task:

| Scenario | Suggested budget | Rationale |
|---|---|---|
| Quick navigation checks | 200-400 | Links and buttons for the next action |
| Form filling | 400-600 | Inputs, labels, and submission controls |
| Broader page context | 600-1000 | More headings, copy, and controls from the selected page view |
| No budget (default) | Unlimited | No token pruning; viewport, hidden-node, and mode filters still apply |

Long loops can start at 300–500 tokens and grow only as the agent needs more context.
