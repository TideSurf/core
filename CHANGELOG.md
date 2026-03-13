# Changelog

## 0.2.3 (2026-03-14)

### Fixed

- Filter `getState()` node maps down to the IDs actually present in the returned XML, so filtered/minimal snapshots no longer leave hidden elements actionable.
- Tighten runtime validation for URLs, search queries, numeric inputs, screenshot options, file paths, and local demo/server ports.
- Confine upload/download filesystem access to `fileAccessRoots` (default: working directory + temp directory), and block `clipboard_read` in read-only sessions.
- Bind the local demo and HTTP bridge to `127.0.0.1` and harden the demo static file serving path handling.
- Remove `evaluate` from read-only sessions so observation mode cannot mutate pages through arbitrary JavaScript.
- Keep the session usable after the initial tab is closed, and preserve visible shadow DOM / iframe content in viewport snapshots.
- Return the nearest interactive TideSurf ID from `search()` when one exists.
- Collapse long `data:` and other oversized page URLs in the XML wrapper so release benchmarks and token budgets reflect page content instead of transport noise.

### Security and release hardening

- Add a repo-root `llms.txt` and publish it with the npm package.
- Sync runtime/package versions for the CLI and MCP adapter, and add a version-sync unit test.
- Strengthen release verification to cover MCP type-checking, browser integration tests, website builds, and `npm pack --dry-run`.
- Make browser integration/benchmark suites self-contained and automatically skip when Chrome cannot launch in the current environment.
- Keep the Chrome sandbox enabled in normal CI runs unless running as root or explicitly opting out.

## 0.2.2 (2026-03-14)

### Fixed

- Correct search/screenshot state handling around the latest tool additions.
- Add regression tests for output modes, tool definitions, validation, viewport filtering, and XML serialization.

## 0.2.1 (2026-03-14)

### Fixed

- Fix read-only MCP tool gating so write tools stay unavailable in observation-only sessions.
- Fix download handling and full-page screenshot behavior introduced in `0.2.0`.

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

Write and sensitive tools disabled in read-only mode: navigate, click, type, select, scroll, evaluate, new_tab, close_tab, upload, clipboard_read, clipboard_write, download. Observation tools remain available: get_state, extract, list_tabs, switch_tab, search, screenshot.

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
