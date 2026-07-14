# Migration guide

Upgrade notes for TideSurf releases with API or output changes.

## v0.3.0 breaking changes

v0.3.0 replaced XML with a markdown-like format that uses **4–5x fewer tokens**.

| Before (XML) | After |
|---|---|
| `<page url="..." title="...">` | `# Title` + `> url \| scroll` |
| `<heading level="1">` | `# Heading` |
| `<link id="L1" href="/">text</link>` | `[L1](/) text` |
| `<button id="B1">text</button>` | `[B1] text` |
| `<input id="I1" type="text" />` | `I1 ~placeholder ="value"` |
| `<form id="F1">` | `FORM F1` |

**Page state field**

```typescript
// Before
const state = await browser.getState();
console.log(state.xml);

// After
const state = await browser.getState();
console.log(state.content);
// state.xml remains as a deprecated alias.
```

**Viewport default**

```typescript
// Before: full page
const state = await browser.getState(); // viewport: false

// After: current viewport
const state = await browser.getState(); // viewport: true

// Request the full page explicitly.
const fullPage = await browser.getState({ viewport: false });
```

Update old XML examples in prompt templates, adapt custom parsers to the new text format, and review `maxTokens` values against the smaller output. Agents that need the full page must pass `{ viewport: false }`.

## v0.2.0 new tools

v0.2.0 added `search`, `screenshot`, `upload`, `clipboard_read`, `clipboard_write`, and `download`, bringing the tool surface to 18. Existing code remains compatible.

## v0.1.2 auto-connect

v0.1.2 added `TideSurf.connect()` for a running Chrome session:

```typescript
const browser = await TideSurf.connect({ port: 9222 });
```

```bash
tidesurf mcp --auto-connect
tidesurf mcp --port 9333
```

## Deprecation policy

Minor `0.x.0` releases may break compatibility; patch `0.0.x` releases remain backward compatible. Deprecated features carry a JSDoc `@deprecated` tag. Aliases such as `PageState.xml` remain until v1.0.0.
