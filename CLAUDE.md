# TideSurf — CLAUDE.md

## What is this?

TideSurf is a TypeScript library that connects Chromium to LLM agents. It launches Chrome via CDP, walks the live DOM, compresses it into token-efficient XML (100–800 tokens per page), and exposes tool definitions for LLM function calling. Ships with an MCP adapter for Claude Code.

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
│   ├── launcher.ts      # Chrome process spawning + DevTools discovery
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
│   ├── xml-serializer.ts # OSNode → compressed XML string
│   └── token-budget.ts  # Token estimation + priority-based pruning
├── tools/
│   ├── definitions.ts   # 12 standard tool definitions for LLM function calling
│   └── executor.ts      # Tool execution engine
mcp/
└── index.ts             # Standalone MCP server adapter (bun mcp/index.ts)
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
- **ID scheme** — Interactive elements get prefix-based IDs: `L` (links), `B` (buttons), `I` (inputs), `S` (selects). These are stable within a single getState() call.
- **Token budgeting** — `getState({ maxTokens })` prunes low-priority elements to fit a budget. Priority: interactive > visible text > structural.
- **MCP as optional** — `@modelcontextprotocol/sdk` and `zod` are `optionalDependencies`. The CLI `mcp` subcommand dynamically imports them.
