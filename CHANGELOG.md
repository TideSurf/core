# Changelog

## 0.2.0 (2026-03-14)

### New tools

6 new tools, bringing the total from 12 to 18:

- **search** — Find text on the page. Returns matches with element IDs and surrounding context
- **screenshot** — Capture the viewport, full page, or a specific element as a base64 PNG
- **upload** — Upload a file to a `<input type="file">` element
- **clipboard_read** — Read the current clipboard contents
- **clipboard_write** — Write text to the clipboard
- **download** — Click a download link/button and capture the downloaded file

### Output modes

`get_state` now accepts a `mode` parameter:

- **`"full"`** (default) — Complete compressed DOM, same as before
- **`"interactive"`** — Only elements with IDs (buttons, links, inputs, selects). Ultra-compact for action-oriented agents
- **`"minimal"`** — Landmarks, headings, and text summaries. Table-of-contents view for page orientation

### Viewport window

`get_state({ viewport: true })` returns only elements visible in the current viewport. The `<page>` tag includes scroll position metadata (`scroll-y`, `scroll-height`, `viewport-height`) so the agent knows where it is and can scroll to reveal more content.

Modes compose: `get_state({ viewport: true, mode: "interactive", maxTokens: 200 })` returns only interactive elements in the viewport, pruned to 200 tokens.

### Read-only mode

Launch or connect with `readOnly: true` to disable all write tools. The agent can observe but not interact — useful for auditing, monitoring, and safe exploration.

```typescript
const browser = await TideSurf.connect({ readOnly: true });
```

```bash
tidesurf mcp --auto-connect --read-only
```

Write tools disabled in read-only mode: navigate, click, type, select, scroll, new_tab, close_tab, upload, clipboard_write, download. Read tools remain available: get_state, extract, evaluate, list_tabs, switch_tab, search, screenshot, clipboard_read.

## 0.1.2 (2026-03-14)

### Auto Connect

- `TideSurf.connect(options?)` — attach to existing Chrome via CDP
- `discoverBrowser()` utility with timeout and retry
- `--auto-connect` and `--port` CLI/MCP flags
- Port validation across all entry points

### Demo

- TideTravel interactive demo site
- `bun run demo` server script

## 0.1.0 (2026-03-13)

Initial release.

- DOM compression via CDP (100–800 tokens per page)
- 12 standard tool definitions for LLM function calling
- Multi-tab support with independent state
- Token budgeting with priority-based pruning
- MCP adapter for Claude Code
- Shadow DOM and iframe traversal
- Typed error hierarchy
- CLI with `inspect` and `mcp` subcommands
- Bun and Node.js 18+ support
