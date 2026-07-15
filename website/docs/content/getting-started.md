# Getting started

TideSurf gives agents a stateful Chromium CLI and a compact view of the live DOM. It also exposes the same 18 tools through the SDK executor and MCP.

## Requirements

Use Node.js 18+ or Bun 1+. Install Chrome stable, Beta, Dev, Canary, or Chromium. TideSurf finds supported installs automatically and never downloads a browser.

Install the CLI:

```bash
brew install TideSurf/tap/tidesurf
# or
npm install --global @tidesurf/core
```

## Start with the CLI

Run a tool command:

```bash
tidesurf navigate https://example.com
tidesurf get_state
```

The first command starts a private local session and a managed headless browser. The second command connects to that session. The latest snapshot ID map, open tabs, and active tab stay in memory between shell calls. Read fresh state after the page changes.

Act with an ID from `get_state`:

```bash
tidesurf click L1
tidesurf get_state --mode interactive --max-tokens 500
tidesurf stop
```

The default session is named `default`. Use a name to isolate work:

```bash
tidesurf --session checkout navigate https://example.com/shop
tidesurf --session checkout get_state
```

`stop` is idempotent. Sessions do not stop while idle. [CLI](#cli) covers every command, startup policy, output mode, and exit code.

## Read page output

TideSurf removes scripts, styles, presentational wrappers, and decorative DOM. It keeps visible copy, semantic structure, control state, and actionable IDs:

```text
# Example Search
> example.com/search | 0/1200 800vh

NAV
  [L1](/) Home
FORM F1
  I1 ~Search... ="TideSurf"
  [B1] Search
```

`B1` identifies the current Search button. Read fresh state after a navigation or dynamic update. Do not guess a new ID when an old one becomes stale. [Page format](#page-format) documents the representation.

Viewport filtering is active by default. Use `--full-page` for all visible page content. Use `--include-hidden` only for full-DOM debugging; it includes hidden nodes and disables viewport filtering.

## Install the SDK

```bash
bun add @tidesurf/core
# or: npm install @tidesurf/core
```

Launch, navigate, read, and act:

```typescript
import { TideSurf } from "@tidesurf/core";

const browser = await TideSurf.launch();
await browser.navigate("https://example.com");

const state = await browser.readPage();
console.log(state.content);

await browser.getPage().click("B1");
await browser.close();
```

`TideSurf.launch()` always starts and owns Chromium. It uses an isolated temporary profile and an ephemeral debugging port unless options override them.

Attach explicitly when another process already exposes CDP:

```typescript
const browser = await TideSurf.connect({
  host: "localhost",
  port: 9222,
});
```

`TideSurf.connect()` never launches a browser. `close()` disconnects an attached browser without stopping its process.

## Select a browser

Managed launch resolves a browser in this order:

1. `chromePath` or CLI `--chrome-path`
2. `CHROME_PATH`
3. supported executable on `PATH`
4. platform install locations

The default channel order is stable, Beta, Dev, Canary, Chromium. Pass `channel: "canary"` or `--channel canary` to select one. Edge and Brave require an explicit executable path.

The CLI uses managed launch by default. `--auto-connect` tries an endpoint or discoverable Chrome profile before local launch. `--connect-only` fails instead of launching.

## Fix session policy

Startup and security options become immutable when a named session starts. A later command may omit them or repeat matching standalone values such as `--read-only`, but it cannot change an explicit value. Stop the session or choose a new name for another policy.

```bash
tidesurf --session audit --read-only get_state
tidesurf --session audit status
```

Read-only sessions allow `get_state`, `extract`, `list_tabs`, `switch_tab`, `search`, and `screenshot`. Navigation, page interaction, JavaScript, clipboard, upload/download, and tab creation or closure fail in the CLI, registry, SDK, and `getPage()` surface.

## Use tool schemas

The registry returns 18 provider-neutral definitions and one executor:

```typescript
import { TideSurf, getToolDefinitions } from "@tidesurf/core";

const browser = await TideSurf.launch();
const tools = getToolDefinitions();
const execute = browser.getToolExecutor();

const result = await execute({
  name: "navigate",
  input: { url: "https://example.com" },
});
```

## Run MCP

Add the packaged adapter to an MCP client:

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

The adapter uses the shared registry and executor. It adds the `launch_browser` lifecycle tool, converts screenshots to image blocks, and marks failed calls with `isError`.

## Next

[CLI](#cli) lists all commands. [Token budget](#token-budget) explains pruning. [Security](#security) defines trust boundaries. [API reference](#api-reference) covers the SDK and tool schemas.
