# Migration guide

This guide helps you upgrade between major versions of TideSurf.

## v0.3.0 Breaking Changes

v0.3.0 introduced a completely new output format that uses **4-5x fewer tokens** than the previous XML format.

### Output format changes

| Before (XML) | After (Markdown-like) |
|-------------|----------------------|
| `<page url="..." title="...">` | `# Title` + `> url \| scroll` |
| `<heading level="1">` | `# Heading` |
| `<link id="L1" href="/">text</link>` | `[L1](/) text` |
| `<button id="B1">text</button>` | `[B1] text` |
| `<input id="I1" type="text" />` | `I1 ~placeholder ="value"` |
| `<form id="F1">` | `FORM F1` |

### API changes

**PageState field renamed:**
```typescript
// Before
const state = await browser.getState();
console.log(state.xml);  // Old field name

// After
const state = await browser.getState();
console.log(state.content);  // New primary field
// state.xml still works but is deprecated
```

**Viewport default changed:**
```typescript
// Before - full page by default
const state = await browser.getState();  // viewport: false

// After - viewport only by default
const state = await browser.getState();  // viewport: true

// To get full page
const state = await browser.getState({ viewport: false });
```

### Action required

1. **Update prompt templates** — If your prompts reference the old XML format (e.g., `<button id="B1">`), update them to recognize the new format (`[B1]`)

2. **Update parsing code** — Any code that parses TideSurf output needs to handle the new format

3. **Review token budgets** — With the new format being 4-5x more efficient, you may want to lower `maxTokens` values or remove them entirely

4. **Check viewport assumptions** — If your agent expects full-page content, explicitly pass `{ viewport: false }`

## v0.2.0 New Tools

v0.2.0 added 6 new tools (bringing total to 18):

- `search` — Find text on the page
- `screenshot` — Capture PNG images
- `upload` — File uploads
- `clipboard_read` — Read clipboard
- `clipboard_write` — Write to clipboard
- `download` — File downloads

No breaking changes — existing code continues to work.

## v0.1.2 Auto-Connect

v0.1.2 introduced `TideSurf.connect()` for attaching to existing Chrome instances:

```typescript
// New in v0.1.2
const browser = await TideSurf.connect({ port: 9222 });
```

CLI additions:
```bash
tidesurf mcp --auto-connect
tidesurf mcp --port 9333
```

## Deprecation policy

- Minor versions (0.x.0) may include breaking changes
- Patch versions (0.0.x) are backward compatible
- Deprecated features are marked with JSDoc `@deprecated` tags
- Deprecated aliases like `PageState.xml` will be removed in v1.0.0
