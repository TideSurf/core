# Changelog

## 0.3.0 (2026-03-16)

### New output format

TideSurf's output has been completely rewritten from XML to a compact, markdown-like text format that uses **4-5x fewer tokens** than the previous XML format:

```
# Page Title
> example.com/search | 0/3000 800vh

NAV
  [L1](/) Home
  [L2](/about) About

FORM F1
  I1 ~Search... ="TideSurf"
  [B1] Search
```

Key changes:
- Headings use `#`/`##`/`###` markers instead of `<heading>` tags
- Links: `[L1](/href) text` instead of `<link id="L1" href="/">text</link>`
- Buttons: `[B1] text` instead of `<button id="B1">text</button>`
- Inputs: `I1:type ~placeholder ="value"` instead of `<input id="I1" type="text" placeholder="..." />`
- Structural containers: `NAV`, `FORM F1`, `TABLE T1` on their own line
- Page wrapper: `# Title` + `> url | scroll` instead of `<page url="..." title="...">`
- No XML escaping needed (plain text)

### Token optimization pipeline

- **URL compression** — strips tracking params (`utm_*`, `fbclid`, `gclid`), relativizes same-origin URLs, drops protocol, truncates long paths
- **Text truncation** — body text outside interactive elements and headings is truncated to 60 chars at word boundaries
- **Sibling deduplication** — runs of 4+ structurally identical siblings (e.g. product cards, search results) are collapsed to 3 examples + a summary like `...17 more (L4-L20)`
- **Attribute reduction** — removes `name`, `data-testid`, `action` from output; elides `type="text"` (default), `method="get"` (default), and duplicate `aria-label`/`placeholder`
- **Heading levels preserved** — H1-H6 now emit `h1`-`h6` instead of generic `heading`, enabling `#`/`##`/`###` in output
- **Conditional structural collapse** — `<section>`, `<article>`, `<aside>` only kept when they have `aria-label` or `role`; `<header>`, `<footer>` only kept when they contain interactive children

### Viewport default

- `getState()` now uses viewport mode by default. Set `viewport: false` for full-page output.
- Off-screen content is summarized as `ABOVE:` / `BELOW:` lines with interactive element counts

### API changes

- `PageState.content` is the new primary field (`.xml` remains as a deprecated alias, both return the same value)
- `GetStateOptions.viewport` now defaults to `true`

### Expected impact

| Page type | Before | After | Reduction |
|---|---|---|---|
| Simple form | ~150 tok | ~40-60 tok | 60-70% |
| Search results (10 items) | ~500 tok | ~100-150 tok | 70-80% |
| E-commerce (20 products) | ~800 tok | ~120-180 tok | 75-85% |
| News article | ~600 tok | ~80-120 tok | 80-85% |

## 0.2.3 (2026-03-14)

### Fixed

- Filter `getState()` node maps down to the IDs actually present in the returned XML, so filtered/minimal snapshots no longer leave hidden elements actionable.
- Tighten runtime validation for URLs, search queries, numeric inputs, screenshot options, file paths, and local demo/server ports.
- Confine upload/download filesystem access to `fileAccessRoots` (default: working directory + temp directory), and block `clipboard_read` in read-only sessions.
- Bind the local demo and HTTP bridge to `127.0.0.1` and harden the demo static file serving path handling.
- Remove `evaluate` from read-only sessions so observation mode cannot mutate pages through arbitrary JavaScript.
- Keep the session usable after the initial tab is closed, and preserve visible shadow DOM / iframe content in viewport snapshots.
- Return the nearest interactive TideSurf ID from `search()` when one exists.
- Collapse long `data:` and other oversized page URLs in the XML wrapper so release benchmarks and token budgets reflect page content instead of transport noise.

### Security and release hardening

- Add a repo-root `llms.txt` and publish it with the npm package.
- Sync runtime/package versions for the CLI and MCP adapter, and add a version-sync unit test.
- Strengthen release verification to cover MCP type-checking, browser integration tests, website builds, and `npm pack --dry-run`.
- Make browser integration/benchmark suites self-contained and automatically skip when Chrome cannot launch in the current environment.
- Keep the Chrome sandbox enabled in normal CI runs unless running as root or explicitly opting out.

## 0.2.2 (2026-03-14)

### Fixed

- Correct search/screenshot state handling around the latest tool additions.
- Add regression tests for output modes, tool definitions, validation, viewport filtering, and XML serialization.

## 0.2.1 (2026-03-14)

### Fixed

- Fix read-only MCP tool gating so write tools stay unavailable in observation-only sessions.
- Fix download handling and full-page screenshot behavior introduced in `0.2.0`.

## 0.2.0 (2026-03-14)

### New tools

6 new tools, bringing the total from 12 to 18:

- **search** — Find text on the page. Returns matches with element IDs and surrounding context
- **screenshot** — Capture the viewport, full page, or a specific element as a base64 PNG
- **upload** — Upload a file to a `<input type="file">` element
- **clipboard_read** — Read the current clipboard contents
- **clipboard_write** — Write text to the clipboard
- **download** — Click a download link/button and capture the downloaded file

### Output modes

`get_state` now accepts a `mode` parameter:

- **`"full"`** (default) — Complete compressed DOM, same as before
- **`"interactive"`** — Only elements with IDs (buttons, links, inputs, selects). Ultra-compact for action-oriented agents
- **`"minimal"`** — Landmarks, headings, and text summaries. Table-of-contents view for page orientation

### Viewport window

`get_state({ viewport: true })` returns only elements visible in the current viewport. The `<page>` tag includes scroll position metadata (`scroll-y`, `scroll-height`, `viewport-height`) so the agent knows where it is and can scroll to reveal more content.

Modes compose: `get_state({ viewport: true, mode: "interactive", maxTokens: 200 })` returns only interactive elements in the viewport, pruned to 200 tokens.

### Read-only mode

Launch or connect with `readOnly: true` to disable all write tools. The agent can observe but not interact — useful for auditing, monitoring, and safe exploration.

```typescript
const browser = await TideSurf.connect({ readOnly: true });
```

```bash
tidesurf mcp --auto-connect --read-only
```

Write and sensitive tools disabled in read-only mode: navigate, click, type, select, scroll, evaluate, new_tab, close_tab, upload, clipboard_read, clipboard_write, download. Observation tools remain available: get_state, extract, list_tabs, switch_tab, search, screenshot.

## 0.1.2 (2026-03-14)

### Auto Connect

- `TideSurf.connect(options?)` — attach to existing Chrome via CDP
- `discoverBrowser()` utility with timeout and retry
- `--auto-connect` and `--port` CLI/MCP flags
- Port validation across all entry points

### Demo

- TideTravel interactive demo site
- `bun run demo` server script

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
