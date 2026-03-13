# Changelog

## 0.2.0 (2026-03-14)

### Auto Connect

Connect to an already-running Chrome instance instead of launching a new one. Re-use logged-in sessions, debug live pages, and seamlessly hand off between manual browsing and agent control.

- Add `TideSurf.connect(options?)` static method — attaches to an existing Chrome via CDP without managing the process lifecycle
- Add `TideSurfConnectOptions` type (`port`, `host`, `timeout`)
- Add `discoverBrowser()` utility — discovers running Chrome instances via `CDP.List()` with actionable error messages
- Add `--auto-connect` and `--port` CLI flags to both `inspect` and `mcp` subcommands
- Add `--auto-connect` and `--port` support to standalone MCP adapter (`mcp/index.ts`)
- `close()` now only disconnects CDP when auto-connected — it never kills or cleans up an external Chrome process

**Usage:**

```typescript
// Programmatic
const browser = await TideSurf.connect({ port: 9222 });

// CLI
tidesurf mcp --auto-connect
tidesurf inspect https://example.com --auto-connect --port 9333
```

```json
// MCP config
{
  "mcpServers": {
    "tidesurf": {
      "command": "bunx",
      "args": ["tidesurf", "mcp", "--auto-connect"]
    }
  }
}
```

## 0.1.2 (2026-03-14)

- Add TideTravel interactive demo site for showcasing browser automation
- Add `bun run demo` server script (localhost:3456)
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
