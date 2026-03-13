# Changelog

## 0.2.3 (2026-03-14)

### Fixed

- Filter `getState()` node maps down to IDs that actually appear in the returned XML.
- Tighten runtime validation for URLs, numeric options, search queries, screenshot options, file paths, and local server ports.
- Confine upload/download filesystem access to `fileAccessRoots` (default: working directory + temp directory), and block `clipboard_read` in read-only sessions.
- Bind the local demo and HTTP bridge to `127.0.0.1` and harden local file serving.
- Remove `evaluate` from read-only sessions so observation mode cannot mutate pages through arbitrary JavaScript.
- Keep the active tab/session usable after the initial tab is closed, and preserve visible shadow DOM / iframe content in viewport snapshots.
- Return the nearest interactive TideSurf ID from `search()` when one exists.
- Collapse long `data:` and other oversized page URLs in the XML wrapper so token budgets track page content instead of transport noise.

### Release hardening

- Add a repo-root `llms.txt` and ship it in the npm package.
- Keep CLI/MCP runtime version strings aligned with package metadata.
- Expand release verification to cover MCP type-checking, browser integration tests, website builds, and `npm pack --dry-run`.
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

6 new tools (total: 18): search, screenshot, upload, clipboard_read, clipboard_write, download.

### Output modes

- `get_state({ mode: "interactive" })` — only clickable/typeable elements
- `get_state({ mode: "minimal" })` — landmarks, headings, text summaries
- `get_state({ viewport: true })` — visible viewport only, with scroll position metadata

### Read-only mode

`readOnly: true` on launch/connect disables write and sensitive tools, including `evaluate` and `clipboard_read`. CLI: `--read-only`.

## 0.1.2 (2026-03-14)

### Auto Connect

- `TideSurf.connect(options?)` — attach to existing Chrome via CDP
- `discoverBrowser()` utility with timeout and retry
- `--auto-connect` and `--port` CLI/MCP flags

### Demo

- TideTravel interactive demo site

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
