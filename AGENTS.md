# TideSurf Agent Guide

Read this before editing the repo. `CLAUDE.md` points here so Claude, Codex, and other agents share one source of truth.

## Project

TideSurf is a TypeScript library that connects Chromium to LLM agents. It launches or connects to Chrome through CDP, walks the live DOM, compresses it into token-efficient text, and exposes browser tools for function-calling agents. It also ships a local MCP adapter for Claude Code and other MCP clients.

## Architecture

```text
src/
  tidesurf.ts              main TideSurf class
  cli.ts                   inspect and mcp commands
  index.ts                 public API exports
  types.ts                 shared CDP, parser, and tool types
  errors.ts                typed error hierarchy
  validation.ts            URL, selector, expression, and element ID validation
  cdp/                     Chrome launch, connection, page, tabs, retries, timeouts
  parser/                  DOM walk, classify, assign IDs, serialize, budget tokens
  tools/                   tool definitions and executor
mcp/
  index.ts                 MCP server adapter
website/
  landing/                 TideSurf landing page
  docs/                    TideSurf documentation app
```

## Commands

Run from the repo root unless a command says otherwise.

```bash
bun install
bun run build
bun run typecheck
bun run test
bun run test:integration
bun run test:bench
bun run build:web:landing
bun run build:web:docs
```

For local website work, use the package scripts directly:

```bash
bun run --cwd website/landing dev
bun run --cwd website/docs dev
```

## Website Design

The website follows the design philosophy of `../mercuriusdream.github.io`.

- Use greyscale paper fields, ink text, and restrained accent fills.
- Prefer flat color differences over rule strokes, borders, shadows, gradients, glass, glow, or decorative chrome.
- Keep the TideSurf name readable in the first viewport.
- Use humane editorial rhythm: generous reading space, compact utility controls, and copy that sounds like a person wrote it.
- Avoid em dashes and repetitive negation chains. Explain the product directly.
- Do not make temporary preview folders or side-spec files part of normal website work. Shape the real source files in `website/landing` and `website/docs`.
- Landing and docs should feel related: same paper, ink, teal accent, square controls, and direct product language.
- Websites must be checked at desktop and mobile widths before shipping. Watch for horizontal overflow, overlapping text, missing CSS bundles, and console errors.

## Product Rules

- TideSurf is DOM-to-text for browser agents.
- Stable IDs such as `L1`, `B2`, and `I3` are the interaction handles.
- CDP is the browser transport. Playwright is not a runtime dependency for the package.
- Read-only mode removes write and sensitive tools from agent-facing definitions.
- MCP dependencies are optional and dynamically imported.

## Coding Rules

- Prefer the existing structure and local helper APIs.
- Keep parser, CDP, validation, and tool changes narrowly scoped.
- Tests should match risk. Parser, validation, and tool behavior need focused unit tests. Browser lifecycle changes usually need integration coverage.
- Use structured parsers and DOM APIs where available.
- Avoid broad refactors during narrow fixes.

## Git Hygiene

- Do not commit generated preview experiments, local caches, temporary Chrome profiles, or unrelated worktree changes.
- Keep commits focused and explain user-facing behavior in the message when possible.
- If the worktree is dirty, inspect before staging. Preserve user changes unless the user explicitly asked to remove them.
