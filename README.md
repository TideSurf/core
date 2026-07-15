<img src="https://tidesurf.org/logo.svg" width="180" height="48" alt="TideSurf">

# TideSurf

**The live page. Agents surfing.**

[Website](https://tidesurf.org) · [Docs](https://tidesurf.org/docs) · [llms.txt](https://tidesurf.org/llms.txt) · [npm](https://www.npmjs.com/package/@tidesurf/core) · [Sponsor](https://github.com/sponsors/MercuriusDream)

TideSurf turns live Chromium pages into compact text for agents. Interactive elements receive short IDs tied to the current DOM. The same 18 tools work through the CLI, SDK executor, and MCP.

## Agent CLI

Run commands directly. The first tool command starts a private local session and a headless, isolated browser. Later shell calls reuse the same browser, tabs, active tab, and element ID map.

```sh
bunx @tidesurf/core navigate https://example.com
bunx @tidesurf/core get-state
bunx @tidesurf/core click L1
bunx @tidesurf/core status
bunx @tidesurf/core stop
```

Use a named session for parallel workflows:

```sh
bunx @tidesurf/core --session research navigate https://example.com
bunx @tidesurf/core --session research get-state --mode interactive
```

TideSurf exposes these direct commands:

```text
get-state       navigate        click           type
select          scroll          extract         evaluate
list-tabs       new-tab         switch-tab      close-tab
search          screenshot      upload          clipboard-read
clipboard-write download
```

Underscore aliases match MCP names, such as `get_state` and `switch_tab`. `tidesurf tools` prints the registry. `tidesurf help <command>` prints generated command help. `tidesurf call <tool> --input '<json>'` accepts a raw tool call.

Managed launch is the default. TideSurf finds Chrome stable, Beta, Dev, Canary, or Chromium and uses an ephemeral debugging port. It checks `--chrome-path`, `CHROME_PATH`, `PATH`, then platform install locations. It never downloads a browser. Use `--auto-connect` to attach when possible and launch locally as a fallback, or `--connect-only` to forbid launch.

Read-only mode fixes the policy for the lifetime of a session:

```sh
bunx @tidesurf/core --session audit --read-only get-state
```

Read-only sessions keep `get-state`, `extract`, `list-tabs`, `switch-tab`, `search`, and `screenshot`. Navigation, page interaction, JavaScript, clipboard, upload/download, and tab creation or closure fail at every SDK and tool boundary.

Startup policy is immutable. Later calls may omit startup flags or repeat matching standalone values such as `--read-only`; conflicting values fail.

## SDK

```sh
bun add @tidesurf/core
```

```ts
import { TideSurf } from "@tidesurf/core";

const browser = await TideSurf.launch();
await browser.navigate("https://example.com");

const state = await browser.getState();
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

`getState()` supports `full`, `interactive`, and `minimal` modes, viewport filtering, and `maxTokens`. `includeHidden: true` is a full-DOM debugging override: it includes hidden nodes and disables viewport filtering.

SDK uploads and downloads default to the working directory and OS temporary directory. Pass `fileAccessRoots: []` to disable SDK filesystem operations.

## MCP

MCP remains available as a thin adapter over the same registry and executor:

```json
{
  "mcpServers": {
    "tidesurf": {
      "command": "bunx",
      "args": ["@tidesurf/core", "mcp"]
    }
  }
}
```

The MCP server exposes the 18 standard tools plus `launch_browser` for compatibility. Screenshot calls return MCP image blocks. Failed calls set `isError`.

Continue with [Getting started](https://tidesurf.org/docs#getting-started), [CLI](https://tidesurf.org/docs#cli), [Security](https://tidesurf.org/docs#security), or the [API reference](https://tidesurf.org/docs#api-reference).

[English](README.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Apache 2.0](LICENSE)
