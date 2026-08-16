---
name: tidesurf-browser
description: "Drive a real Chromium browser through the tidesurf CLI or MCP tools. Use when a task needs live web browsing: reading pages as compact, token-efficient text with action IDs; clicking, typing, selecting, and scrolling elements by ID; taking screenshots of the full page, viewport, or one element; managing tabs; handling file uploads and downloads; or extracting page data by selector. Works against a Chromium instance that tidesurf launches or attaches to over CDP."
license: Apache-2.0
metadata:
  version: "0.7.1"
  author: "TideSurf Contributors"
---

# TideSurf Browser

TideSurf gives you a real Chromium browser. It launches a browser or attaches to a running one over CDP, then compresses the live DOM into token-efficient text annotated with action IDs. You read the page as text, act on elements by ID, and re-read to see the result.

The full input table for every tool is in [references/tool-reference.md](references/tool-reference.md).

## The core loop

Every browser task follows the same loop:

1. `get_state` to read the current page as compact text. Interactive elements are tagged with IDs like `L1` (link), `B2` (button), `I3` (input).
2. Pick the element ID that matches your intent.
3. Act on it: `click`, `type`, `select`, or `scroll`.
4. Re-read with `get_state` to observe the result.

Element IDs are snapshot-scoped. An ID is valid only for the snapshot that produced it. Navigation, DOM mutations, and most actions invalidate prior IDs. Never reuse an ID from an earlier snapshot; call `get_state` again and use the fresh IDs. This applies even when the page "looks the same" — re-rendered nodes get new IDs.

## Token discipline

Page state is the main context cost. Control it:

- Pass `maxTokens` to `get_state` to cap the snapshot size. Start small and raise it only if the element you need is missing.
- Pass `viewport: true` to restrict the snapshot to what is on screen.
- Use `mode` to shape the output: `full` for the complete annotated DOM, `minimal` for structure only, `interactive` for actionable elements only. Prefer `interactive` when you only need to act.
- On huge pages, run `search` with a query first to locate the relevant region instead of dumping full state.
- Use `includeHidden` only when the element you need is not visible (e.g. collapsed menus).

## Forms

- `type` enters text into an input by ID. Pass `clear: true` to replace existing content instead of appending.
- `select` sets a `<select>` element by ID to a given option `value`.
- `upload` attaches a local file to a file input by ID. `filePath` must be a path on the local filesystem.
- After submitting a form, treat the page as changed: re-read state before doing anything else.

## Tabs

- `list_tabs` returns all open tabs with their tab IDs, URLs, and titles.
- `new_tab` opens a tab, optionally at a `url`.
- `switch_tab` and `close_tab` take a `tabId` from `list_tabs`. Do not guess tab IDs.
- After `switch_tab`, call `get_state` — element IDs from the previous tab do not carry over.

## Screenshots

`screenshot` captures the full page (`fullPage: true`), the current viewport (default), or a single element (`elementId`). Screenshots are read-only: they never modify page state, so IDs remain valid after taking one.

## Downloads and data extraction

- `download` triggers a download from an element (by ID, e.g. a download link or button) and saves it under `downloadDir`. Set `timeout` for slow servers.
- For pulling data out of a page, prefer `extract` with a CSS `selector` when the target is identifiable by selector — it is cheaper than a full state dump.
- Use `evaluate` to run a JavaScript expression in the page when neither selectors nor snapshots suffice (computed values, custom traversal).

## Read-only mode

If the server rejects write tools, it is running read-only. Only observation tools are available: `get_state`, `extract`, `list_tabs`, `switch_tab`, `search`, `screenshot`. Plan tasks around reading and reporting; do not attempt clicks, navigation, or form actions in this mode.

## Failure recovery

- `ElementNotFoundError` means the snapshot is stale. Call `get_state` and retry with a fresh ID.
- CDP timeouts usually mean the page is navigating, reloading, or blocked by a dialog. Call `get_state` to see what actually happened before deciding next steps.
- Never blindly retry a committed navigation or form action (submit, purchase, delete). The first attempt may have succeeded server-side; re-read state or check the URL to confirm before retrying.
- If `click` had no visible effect, the element may have been covered or the page may have changed underneath. Re-read state and verify the element still exists and is actionable.

## CLI quick reference

The same tools are available through the `tidesurf` CLI:

```bash
tidesurf start                  # launch or attach to Chromium
tidesurf status                 # check whether a browser session is running
tidesurf stop                   # shut the session down
tidesurf inspect <url>          # open a URL and print the compressed page state
tidesurf tools                  # list all available tools
tidesurf call <tool> --input '{"url": "https://example.com"}'   # invoke one tool with JSON input
```

Use the CLI for one-off checks or scripts; use the MCP tools when operating inside an agent loop.
