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
bun test             # Unit tests (no Chrome needed)
bun run build        # Compile TS to dist/
```

Integration tests require Chrome installed locally:

```bash
bun run test:integration
```

## Pull requests

1. Fork the repo and create a branch from `main`.
2. Make your changes. Add tests if you're adding behavior.
3. Run `bun run typecheck && bun test` to verify.
4. Open a PR. The template will guide you.

Keep PRs focused — one concern per PR. If your change touches the serializer output format, include before/after examples.

## Architecture

See [CLAUDE.md](CLAUDE.md) for a source tree overview and [architecture docs](https://tidesurf.org/docs#architecture) for the data flow.

## Code style

- TypeScript, strict mode
- No external runtime dependencies beyond `chrome-remote-interface`
- Tests use `bun test` (jest-compatible globals)
- Prefer explicit over clever
