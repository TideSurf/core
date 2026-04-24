# Changelog

## 0.5.3 (2026-04-25)

### Fixed

- **MCP browser boot** — Register Chrome crash listeners on the Inspector CDP domain instead of the Page domain, fixing launch/connect failures caused by unsupported `Page.targetCrashed` handlers.
- **Launch cleanup** — Failed `TideSurf.launch()` setup now disconnects any opened CDP session, terminates the spawned Chrome process, and removes owned temporary profiles before rethrowing.
- **Trusted local development URLs** — Added explicit `allowLocalhost` and `allowPrivateHosts` options for CLI, MCP, and SDK navigation. Local/private URLs remain blocked by default, while trusted MCP/dev sessions can opt in.
- **Tool validation flow** — Removed duplicate URL validation in tool execution and routed navigation/new-tab tools through the authoritative `TideSurf` instance methods.
- **Auto-connect fallback** — CLI and MCP auto-connect now fall back to launching only for CDP connection failures instead of swallowing unrelated errors.
- **Tab policy preservation** — Switching to an untracked tab now preserves the instance URL policy and filesystem access roots.

### Tests

- Browser integration tests now use a real local HTTP fixture server instead of blocked `data:` URLs.
- `verify:release` now includes browser integration tests before build and pack checks.

## 0.5.2 (2026-04-18)

### Security

- **Expression denylist bypass** — `validateExpression()` can no longer be bypassed via bracket-notation indexing (`document["cookie"]`), the comma-operator eval trick (`(0,eval)(...)`), or the `"".constructor.constructor(...)` prototype walk. Unicode/hex escape sequences (`\uXXXX`, `\xXX`, `\u{XXXX}`) are decoded before scanning, `[ "name" ]`/`[ 'name' ]`/`[ \`name\` ]` are normalized to dot access, and `.constructor` and `import()` are now on the denylist.
- **SSRF filter bypass** — IPv4-mapped IPv6 addresses (`::ffff:169.254.169.254`, the AWS metadata endpoint) are now unmapped and re-checked against the private-IPv4 ranges. The IPv6 unspecified address (`::`) and the full `fc00::/7` ULA range are also blocked; the previous filter only matched `fc00:` and missed `fd00:`.
- **Clipboard rate-limit TOCTOU** — `clipboardRead()` now reserves the 5-second cooldown slot *before* awaiting the clipboard read, closing a TOCTOU where a `Promise.all` of N concurrent calls all passed the stale-timestamp check and read in parallel.

### Fixed

- **`waitForStable()` zombie timer** — Each call now owns a private context on `window.__tidesurf_stable` rather than sharing timer state. New calls cancel the prior context (clear its timer, mark cancelled), preventing a 500ms early-resolve timer from the previous call from disconnecting the new observer and silently reporting "stable".
- **`closeTab()` bricking on last-tab close** — The stale-page cleanup loop no longer uses a pre-`newTab()` snapshot of the tab list, which previously caused it to immediately close the fresh `about:blank` created after closing the last tab, leaving `activePage` pointing at a dead connection.
- **`search()` ID divergence from `lastNodeMap`** — Search results now cross-reference fresh IDs against `lastNodeMap` by `backendNodeId`. Only `elementId`s that resolve to the same node that `click()`/`type()` would hit are returned; otherwise the ID is dropped rather than silently pointing at the wrong element after DOM mutations.
- **`getFullDOM()` OOM guard** — Element count is now pre-checked via `Runtime.evaluate` *before* `DOM.getDocument`, so `chrome-remote-interface` no longer `JSON.parse`s a 200k-node response into memory just to discover it's too large. The post-parse guard remains as a secondary check for shadow/iframe/text nodes.

### Tests

- 8 new regression tests covering every bypass and correctness fix above.

## 0.5.1 (2026-04-14)

### Fixed

- **HIGH-002b: Fast typing** — Replace per-character `Input.dispatchKeyEvent` loop with single `Input.insertText` call. Typing 100 characters now takes 1 CDP round-trip instead of 200, providing ~200x speedup for text input operations.
- **NEW-CRIT-004: URL length validation** — Add 2048-character limit to `validateUrl()` to prevent potential buffer overflow and DoS from extremely long URLs.
- **NEW-CRIT-005: DOM node count limit** — Add 50,000-node limit check in `getFullDOM()` to prevent memory exhaustion on pages with extremely large DOMs. Returns helpful error message suggesting viewport mode or simpler page.

### Security

All 171 fixes documented in FIXES.md are now verified as implemented:

| Severity | Count |
|----------|-------|
| Critical (P0) | 16 |
| High (P1) | 43 |
| Medium (P2) | 67 |
| Low (P3) | 45 |

Key security improvements in v0.5.x:
- Restricted `evaluate()` tool blocks `document.cookie`, `localStorage`, `fetch()`, `eval()` patterns
- `data:` URLs blocked to prevent XSS and data exfiltration
- Clipboard read rate-limited to 1 read per 5 seconds
- XSS prevention via HTML entity escaping in serializer output

### Performance

- Token budget algorithm: 172x speedup (O(n) vs O(n²))
- Character typing: 200x speedup (1 vs 2N round-trips)
- CDP calls per getState: 3x reduction (2 vs 6 calls)
- collectText: 40x speedup via memoization

### Stability

- 13 race conditions fixed (browser init, tab switching, downloads, signal handlers)
- Chrome crash detection with `isDead` flag
- Stack overflow protection with `MAX_DEPTH = 500` in DOM walker and filters
- Proper cleanup of CDP connections and Chrome processes

## 0.5.0 (2026-03-29)

### New

- **Element state awareness** — Interactive elements now serialize their runtime state directly into the compressed output. Disabled and inert elements are wrapped in `~~strikethrough~~` (covering HTML `disabled`, `aria-disabled`, `<fieldset disabled>` inheritance, `pointer-events: none`, and the `inert` attribute). Toggle state uses `open`/`closed` keywords (from `aria-expanded`). Inputs display `checked`, `required`, `readonly`, and constraint attributes (`min`, `max`, `step`, `pattern`).
- **Computed CSS visibility checks** — `getState()` now inspects computed styles (`opacity`, `visibility`, `display`, `clip-path`, `pointer-events`) to filter out elements that are present in the DOM but not visible or usable on the page.
- **Interaction state detection** — TideSurf detects elements obscured by overlays (modal backdrops, cookie banners) and marks them with an `obscured` keyword. The agent knows to dismiss the blocker before interacting.
- **`includeHidden` option** — `getState({ includeHidden: true })` bypasses CSS visibility filtering to include all DOM elements regardless of computed style. Useful for debugging hidden menus, lazy-loaded content, and off-screen elements.
- **OPTION/OPTGROUP handling** — Select dropdowns now serialize their options with group labels and a `>` prefix for the currently selected option(s). Disabled options and `multiple` selects are represented.
- **Dialog element support** — `<dialog>` elements receive `D` prefix IDs (e.g. `D1`), joining the existing L/B/I/S/F/T prefix scheme.

### Tests

- Migrated test runner from vitest to `bun test`.
- 126 new unit tests covering element state serialization, computed visibility checks, interaction state detection, select/option handling, and edge cases. 324 total.

## 0.4.0 (2026-03-28)

### Improved

- **Detailed tool responses** — Action tools (`click`, `scroll`, `switch_tab`) now return the resulting page state so models can see what their actions caused. No more blind `"Clicked B1"` — the model immediately knows whether the page navigated, a modal opened, or content changed.
- **Actionable error messages** — Errors now include guidance on what to do next. Element not found → "call get_state to see current IDs". Timeout → "page may still be loading, call get_state". Chrome connection errors → step-by-step setup instructions.
- **CLI executor parity** — `executor.ts` (used by CLI and direct SDK) now returns the same level of detail as the MCP adapter.

## 0.3.4 (2026-03-22)

### Fixed

- Enforce read-only mode on `TideSurf.navigate()` at the SDK level. Previously, `readOnly` was only checked in the tool executor — direct SDK callers could still navigate. A new `ReadOnlyError` is thrown when `navigate()` is called in read-only sessions.
- `viewport: false` now works in both MCP servers. A truthiness bug silently dropped `false`, making full-page state unreachable via `get_state`. Both `src/cli.ts` and `mcp/index.ts` now forward the parameter correctly.
- Icon-only buttons and links (e.g. SVG-only controls) now render their `aria-label` or `title` instead of producing blank `[B1]` / `[L1]` entries.
- `type()` and `select()` now call `waitForStable()` after the action, matching `click()` and `scroll()`. This prevents race conditions with reactive forms, validation messages, and dependent dropdowns.
- `selectOption()` now dispatches both `input` and `change` events (was `change` only), improving compatibility with framework-controlled inputs.
- Add `launch_browser` tool and auto-connect fallback to the packaged `tidesurf mcp` server, matching the repo-only MCP adapter. Remove the broken `bun mcp/index.ts` suggestion from the error message.
- Docs TOC links are now shareable — hash format changed from `#heading-N` (which collided with page routing) to `#page-name:heading-N`.
- Docs language switcher now shows a notice when viewing in Japanese/Korean that content is in English.
- Fix misleading "Full page (default)" comment in getting-started docs — now accurately reflects that viewport defaults to `true`.

### Removed

- Dead `searchPage()` function from `src/cdp/connection.ts` (superseded by `SurfingPage.search()`).
- Dead `deduplicateSiblings` module (`src/parser/dedup.ts`) removed from the pipeline in v0.3.1 but never deleted.

### Improved

- Token budget pruning (`pruneToFit`) now recurses into large container children when top-level pruning alone cannot meet the budget. Pages dominated by a single `<main>` wrapper are now prunable.

### Docs

- Rewrote `README.md` with installation, quick start, CLI usage, MCP integration, and read-only examples.
- Added **Security model** documentation page (read-only enforcement, filesystem confinement, input validation, CDP security).
- Added **Agent patterns** documentation page (basic agent loop, authenticated sessions, token-efficient browsing, multi-tab workflows, form filling).

### Landing page

- Added "Built for agents" section with Observe / Act / Integrate pattern cards.
- Added "Safe by default" section showcasing security features.

## 0.3.3 (2026-03-21)

### Fixed

- Robust Chrome launch with port-polling fallback. Chrome on macOS may not write the DevTools URL to stderr when another instance is already running — CDP port polling is now used as a fallback detection method, and leaked Chrome processes are killed on timeout to prevent zombie processes from blocking retries.

### Chore

- Upgrade GitHub Actions to Node.js 24-compatible versions (`actions/checkout` v4 → v5, `actions/setup-node` v4 → v5, `node-version` 20 → 22).

## 0.3.2 (2026-03-19)

### New tools

- **launch_browser** — Launch a new Chrome instance from the agent. Uses port 9223 by default to avoid conflicts with user's running Chrome on 9222. Defaults to headless; the model can choose headful via the tool.

### Fixed

- Auto-launch browser when `--auto-connect` fails. When no running Chrome is found, TideSurf now falls back to launching a new instance instead of erroring out.

## 0.3.1 (2026-03-16)

### Fixed

- Remove sibling deduplication from the pipeline. The optimization was lossy — it collapsed repeated elements (product cards, search results) into summaries, preventing the agent from reading omitted items. All page content is now preserved losslessly.
- Update benchmark numbers to reflect the lossless pipeline.

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
