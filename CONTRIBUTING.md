# Contributing to TideSurf

Thanks for your interest in contributing.

## Setup

```bash
git clone https://github.com/TideSurf/core.git
cd core
bun install
```

## Development

```bash
bun run typecheck    # Type-check without emitting
bun run test         # Unit tests (no Chrome needed)
bun run build        # Compile TS to dist/
```

Integration and benchmark tests require Chrome installed locally:

```bash
bun run test:integration
bun run test:bench
```

Run `bun run smoke:pack` after package or CLI changes. It installs the generated
tarball and checks the CLI and MCP stdio adapter under Node and Bun. Before a
release, run the complete `bun run verify:release` gate.

Run `bun run check:docs` after changing tools, CLI behavior, public SDK options,
documentation, website embeds, changelogs, benchmarks, or social-preview sources.

## Pull requests

1. Fork the repo and create a branch from `main`.
2. Make your changes. Add tests if you're adding behavior.
3. Run `bun run typecheck && bun run test` to verify.
4. Open a PR. The template will guide you.

Keep PRs focused on one concern. If your change touches the serializer output format, include before/after examples.

## Architecture

See [CLAUDE.md](CLAUDE.md) for a source tree overview and [architecture docs](https://tidesurf.org/docs#architecture) for the data flow.

## Code style

- TypeScript, strict mode
- Keep the browser core limited to `chrome-remote-interface`; MCP SDK and Zod stay optional
- Tests use `bun test` (jest-compatible globals)
- Prefer explicit over clever
