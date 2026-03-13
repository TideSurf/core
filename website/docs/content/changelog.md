# Changelog

## 0.2.0 (2026-03-14)

### New tools

6 new tools (total: 18): search, screenshot, upload, clipboard_read, clipboard_write, download.

### Output modes

- `get_state({ mode: "interactive" })` — only clickable/typeable elements
- `get_state({ mode: "minimal" })` — landmarks, headings, text summaries
- `get_state({ viewport: true })` — visible viewport only, with scroll position metadata

### Read-only mode

`readOnly: true` on launch/connect disables write tools. CLI: `--read-only`.

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
