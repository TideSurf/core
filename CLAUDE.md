# TideSurf — CLAUDE.md

## What is this?

TideSurf is a TypeScript library that connects Chromium to LLM agents. It launches Chrome via CDP, walks the live DOM, compresses it into a token-efficient markdown-like format (50–200 tokens per page), and exposes tool definitions for LLM function calling. Ships with an MCP adapter for Claude Code.

## Architecture

```
src/
├── tidesurf.ts          # Main TideSurf class — launch, navigate, getState, tab mgmt
├── cli.ts               # CLI entry point (inspect / mcp subcommands)
├── index.ts             # Public API exports
├── types.ts             # Shared types (CDPNode, OSNode, PageState, etc.)
├── errors.ts            # Typed error hierarchy (TideSurfError → CDPConnectionError, etc.)
├── validation.ts        # Input validators (URL, selector, expression, element ID)
├── cdp/
│   ├── launcher.ts      # Chrome process spawning + DevTools discovery + auto-connect
│   ├── connection.ts    # CDP WebSocket connection
│   ├── page.ts          # SurfingPage — per-tab page interaction
│   ├── tab-manager.ts   # Multi-tab lifecycle (create, switch, close)
│   ├── timeout.ts       # withTimeout utility
│   ├── retry.ts         # withRetry utility
│   └── viewport.ts      # Viewport configuration
├── parser/
│   ├── dom-walker.ts    # Recursive DOM traversal (shadow DOM + iframes)
│   ├── element-classifier.ts  # KEEP / COLLAPSE / DISCARD per element
│   ├── id-assigner.ts   # Assigns L/B/I/S IDs to interactive elements
│   ├── serializer.ts     # OSNode → compact markdown-like text
│   ├── url-compressor.ts # URL compression (strip tracking, relativize, truncate)
│   └── token-budget.ts   # Token estimation + priority-based pruning
├── tools/
│   ├── definitions.ts   # 18 tool definitions for LLM function calling
│   └── executor.ts      # Tool execution engine
mcp/
└── index.ts             # Local MCP server adapter (bun mcp/index.ts)
```

## Dev commands

```bash
bun install              # Install dependencies
bun run build            # Compile TS → dist/
bun run typecheck        # Type-check without emitting
bun run test             # Unit tests (no Chrome needed)
bun run test:integration # Integration tests (requires Chrome installed)
bun run test:bench       # Compression benchmarks
bun run test:all         # All tests
```

## Requirements

- **Bun** ≥ 1.0 or **Node.js** ≥ 18
- **Chrome/Chromium** installed locally (auto-detected, or set `CHROME_PATH`)

## Key design decisions

- **No screenshots/vision** — DOM compression only. This keeps token costs 10–100× lower than screenshot-based approaches.
- **CDP, not Playwright** — Direct CDP over `chrome-remote-interface` avoids the Playwright dependency tree. Tradeoff: no Firefox/Safari.
- **Lazy browser launch** — Chrome starts on first tool call, not on import.
- **ID scheme** — Interactive elements get prefix-based IDs: `L` (links), `B` (buttons), `I` (inputs), `S` (selects), `F` (forms), `T` (tables), `D` (dialogs). These are stable within a single getState() call.
- **Token budgeting** — `getState({ maxTokens })` prunes low-priority elements to fit a budget. Priority: interactive > visible text > structural.
- **Auto-connect** — `TideSurf.connect()` attaches to an already-running Chrome instead of spawning one. Uses `discoverBrowser()` to probe CDP on a given port. When auto-connected, `close()` only disconnects CDP — it never kills the external process.
- **Output modes** — `getState({ mode })` supports `"full"`, `"minimal"` (landmarks + summaries), and `"interactive"` (only elements with IDs). Viewport mode is on by default (`viewport: false` for full page).
- **Read-only mode** — `readOnly: true` disables write tools. Agent can observe but not interact.
- **MCP as optional** — `@modelcontextprotocol/sdk` and `zod` are `optionalDependencies`. The CLI `mcp` subcommand dynamically imports them.
