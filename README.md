<img src="https://tidesurf.org/logo.svg" width="180" height="48" alt="TideSurf">

# TideSurf

**Agents Surfing**

[Website](https://tidesurf.org) · [Docs](https://tidesurf.org/docs) · [llms.txt](https://tidesurf.org/llms.txt) · [npm](https://www.npmjs.com/package/@tidesurf/core) · [Sponsor](https://github.com/sponsors/MercuriusDream)

TideSurf turns live Chromium pages into compact text for agents. Interactive elements receive short IDs tied to the current DOM. The same 18 tools work through the CLI, SDK executor, and MCP.

## Install

```sh
brew install TideSurf/tap/tidesurf
# or
npm install --global @tidesurf/core
```

## Agent CLI

Run commands directly. The first tool command starts a private local session and a headless, isolated browser. Later shell calls reuse the same browser, tabs, active tab, and element ID map.

```sh
tidesurf navigate https://example.com
tidesurf get_state
tidesurf click L1
tidesurf status
tidesurf stop
```

Use a named session for parallel workflows:

```sh
tidesurf --session research navigate https://example.com
tidesurf --session research get_state --mode interactive
```

TideSurf exposes these direct commands:

```text
get_state       navigate        click           type
select          scroll          extract         evaluate
list_tabs       new_tab         switch_tab      close_tab
search          screenshot      upload          clipboard_read
clipboard_write download
```

Direct commands use the exact registry and MCP tool identifiers. `tidesurf tools` prints the registry, `tidesurf help <command>` prints command help, and `tidesurf call <tool> --input '<json>'` accepts a raw tool call.

Managed launch is the default. TideSurf finds Chrome stable, Beta, Dev, Canary, or Chromium and uses an ephemeral debugging port. It checks `--chrome-path`, `CHROME_PATH`, `PATH`, then platform install locations. It never downloads a browser. Use `--auto-connect` to attach to a running Chrome before launching, or `--connect-only` to forbid launch. An explicit endpoint that fails never falls back to a different running browser.

Read-only policy remains fixed for the session lifetime:

```sh
tidesurf --session audit --read-only get_state
```

Read-only sessions keep `get_state`, `extract`, `list_tabs`, `switch_tab`, `search`, and `screenshot`. Navigation, page interaction, JavaScript, clipboard, upload/download, and tab creation or closure fail at every SDK and tool boundary.

Every startup flag works the same way: later calls may omit it or repeat a matching standalone value; conflicting values fail.

## SDK

```sh
bun add @tidesurf/core
```

```ts
import { TideSurf } from "@tidesurf/core";

const browser = await TideSurf.launch();
await browser.navigate("https://example.com");

const state = await browser.readPage();
console.log(state.content);

await browser.getPage().click("B1");
await browser.close();
```

The page returns as plain text with live handles:

```text
# Example Search
> example.com/search | 0/1200 800vh

NAV
  [L1](/) Home
  [L2](/about) About
FORM F1
  I1 ~Search... ="TideSurf"
  [B1] Search
```

`B1` points to the current Search button. IDs belong to that snapshot. Read fresh state after page changes.

`TideSurf.launch()` always launches and owns Chromium. It uses an isolated temporary profile unless `userDataDir` selects another profile. `TideSurf.connect()` always attaches to an existing endpoint and defaults to port `9222`. Closing an attached instance disconnects without stopping the user browser.

`readPage()` supports `full`, `interactive`, and `minimal` modes, viewport filtering, and `maxTokens`. `includeHidden: true` includes hidden nodes and disables viewport filtering. The deprecated `getState()` alias delegates to `readPage()`.

SDK uploads and downloads default to the working directory and OS temporary directory. Pass `fileAccessRoots: []` to disable SDK filesystem operations.

## MCP

MCP is a thin adapter over the same registry and executor:

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

The MCP server exposes the 18 standard tools plus the `launch_browser` lifecycle tool. Screenshot calls return MCP image blocks. Failed calls set `isError`.

Continue with [Getting started](https://tidesurf.org/docs#getting-started), [CLI](https://tidesurf.org/docs#cli), [Security](https://tidesurf.org/docs#security), or the [API reference](https://tidesurf.org/docs#api-reference).

[English](README.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Apache 2.0](LICENSE)
