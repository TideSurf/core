# Changelog

## 0.2.0 (2026-03-14)

Auto Connect — connect to an already-running Chrome instance.

- `TideSurf.connect(options?)` — attach to existing Chrome via CDP
- `TideSurfConnectOptions` type (`port`, `host`, `timeout`)
- `discoverBrowser()` utility for Chrome instance discovery
- `--auto-connect` and `--port` CLI/MCP flags
- `close()` skips process cleanup when auto-connected

## 0.1.2 (2026-03-14)

- Add TideTravel interactive demo site
- Add `bun run demo` server script
- Add demo prompt for end-to-end booking flow

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
