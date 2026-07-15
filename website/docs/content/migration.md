# Migration guide

Upgrade notes for TideSurf releases with API or output changes.

## v0.6.0

v0.6.0 adds a stateful CLI. Install it, then call tools across separate shell processes:

```bash
brew install TideSurf/tap/tidesurf
# or
npm install --global @tidesurf/core

tidesurf navigate https://example.com
tidesurf get_state
tidesurf click L1
```

Direct CLI commands use the exact registry and MCP identifiers, including underscores in `get_state`, `list_tabs`, `new_tab`, `switch_tab`, `close_tab`, `clipboard_read`, and `clipboard_write`. The CLI, SDK executor, and packaged MCP adapter share one registry, schema, and handler for each of the 18 tools.

The first tool command starts a named local session and managed browser. Later commands reuse its active tab and exact element ID map. Startup and security policy remain fixed until `tidesurf stop`; choose another `--session` name for a different policy.

Managed launches now select an ephemeral debugging port unless `port` or `--port` is explicit. `TideSurf.launch()` remains strict launch, while `TideSurf.connect()` remains strict attach and defaults to port `9222`. `ChromeChannel` and `TideSurfOptions.channel` select stable, Beta, Dev, Canary, or Chromium.

`includeHidden: true` now means full-DOM debugging: it includes hidden nodes and disables viewport filtering. Read-only mode is enforced by the registry, executor, `TideSurf`, and direct `SurfingPage` methods. `switch_tab` remains available because it changes only the observation target.

The unpublished standalone MCP implementation was removed. Use the packaged adapter from the installed CLI:

```json
{
  "mcpServers": {
    "tidesurf": {
      "command": "tidesurf",
      "args": ["mcp"]
    }
  }
}
```

`evaluate` now validates expression shape and size only. It runs arbitrary unsandboxed page JavaScript. Use read-only mode when page JavaScript must be unavailable.

## Preferred page-read method

Use `readPage()` in new SDK code:

```typescript
const state = await browser.readPage();
```

The deprecated `getState()` method remains as a compatibility alias and returns the same `PageState`. `GetStateOptions` likewise aliases `ReadPageOptions`.

## v0.3.0 breaking changes

v0.3.0 replaced XML with a markdown-like format that uses **4–5x fewer tokens**.

| Before (XML) | After |
|---|---|
| `<page url="..." title="...">` | `# Title` + `> url \| scroll` |
| `<heading level="1">` | `# Heading` |
| `<link id="L1" href="/">text</link>` | `[L1](/) text` |
| `<button id="B1">text</button>` | `[B1] text` |
| `<input id="I1" type="text" />` | `I1 ~placeholder ="value"` |
| `<form id="F1">` | `FORM F1` |

**Page state field**

Use `state.content`. `state.xml` remains as a deprecated alias.

```typescript
const state = await browser.readPage();
console.log(state.content);
```

**Viewport default**

```typescript
// Before: full page
const state = await browser.readPage({ viewport: false });

// After: current viewport
const state = await browser.readPage(); // viewport: true

// Request the full page explicitly.
const fullPage = await browser.readPage({ viewport: false });
```

Update old XML examples in prompt templates, adapt custom parsers to the new text format, and review `maxTokens` values against the smaller output. Agents that need the full page must pass `{ viewport: false }`.

## v0.2.0 new tools

v0.2.0 added `search`, `screenshot`, `upload`, `clipboard_read`, `clipboard_write`, and `download`, bringing the tool surface to 18. Existing code remains compatible.

## v0.1.2 auto-connect

v0.1.2 added `TideSurf.connect()` for a running Chrome session:

```typescript
const browser = await TideSurf.connect({ port: 9222 });
```

```bash
tidesurf mcp --auto-connect
tidesurf mcp --connect-only --port 9333
```

## Deprecation policy

Minor `0.x.0` releases may break compatibility; patch `0.0.x` releases remain backward compatible. Deprecated features carry a JSDoc `@deprecated` tag. Aliases such as `PageState.xml` remain until v1.0.0.
