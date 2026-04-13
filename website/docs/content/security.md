# Security model

TideSurf runs with full access to Chrome's DevTools Protocol. Understanding the security boundaries helps you deploy safely.

## Read-only mode

Launch or connect with `readOnly: true` to restrict the session to observation-only. This prevents:

- Page navigation and modification (`navigate`, `click`, `type`, `select`, `scroll`)
- JavaScript execution (`evaluate`)
- Clipboard access (`clipboard_read`, `clipboard_write`)
- File operations (`upload`, `download`)
- Tab creation and closure (`new_tab`, `close_tab`)

Observation tools remain available: `get_state`, `extract`, `list_tabs`, `switch_tab`, `search`, `screenshot`.

**Important:** Read-only mode is enforced at the tool layer (tool executor and MCP server). If you use the SDK directly via `browser.getPage()`, you bypass this guard and can still call mutating methods on the `SurfingPage` instance. This is by design — SDK users are expected to manage their own access control. The `TideSurf.navigate()` method does enforce read-only at the SDK level.

## Filesystem confinement

The `upload` and `download` tools restrict file access to `fileAccessRoots`, which default to the current working directory and the OS temp directory. Override explicitly:

```typescript
const browser = await TideSurf.launch({
  fileAccessRoots: [process.cwd(), "/shared/fixtures"],
});
```

Paths outside these roots are rejected with a `ValidationError`.

## Input validation

All tool inputs are validated before execution:

| Input | Validation |
|---|---|
| URLs | Must be `http:` or `https:` protocol; private IP addresses (localhost, 127.x, 10.x, 192.168.x) are blocked |
| CSS selectors | Max length 1000 characters; dangerous patterns blocked |
| JavaScript expressions | Max length 10000 characters; blocked patterns: `document.cookie`, `localStorage`, `sessionStorage`, `indexedDB`, `fetch`, `XMLHttpRequest`, `WebSocket`, `eval`, `Function` |
| Element IDs | Must match `[LBISFTD]\d+` pattern |
| File paths | Must resolve inside `fileAccessRoots` |
| Numeric inputs | Must be positive integers/numbers where required |

## CDP connection security

- TideSurf connects to Chrome over a local WebSocket. The CDP port (default 9222) should not be exposed to untrusted networks.
- When using `TideSurf.connect()`, TideSurf attaches to whatever Chrome instance is listening. It does not verify identity — ensure only your Chrome is on the expected port.
- `close()` on a connected (not launched) instance only disconnects CDP. It never kills the browser process.

## Computed visibility and element state

TideSurf now inspects computed CSS styles to determine element visibility and interactability. Before serializing the DOM, it checks properties including `opacity`, `visibility`, `display`, `clip-path`, and `pointer-events` to filter out elements that are present in the DOM but not visible or usable on the page.

This filtering uses `data-os-state` attributes injected into the DOM during the `getState()` walk. In theory, page JavaScript could race against TideSurf's DOM walk via a `MutationObserver` to spoof these attributes — for example, marking a hidden element as visible. This is mitigated by performing a bulk cleanup of all `data-os-state` attributes before each `getState()` call, ensuring stale or spoofed values from a previous pass are removed before the fresh walk begins.

For debugging purposes, the `includeHidden` option can be passed to `getState()` to bypass CSS visibility filtering and include all DOM elements regardless of their computed style. This is useful for inspecting pages where elements are intentionally hidden (e.g. off-screen menus, lazy-loaded content) but should not be used in production agent loops, as it may expose non-interactive elements that inflate token usage.

## Evaluate safety

The `evaluate` tool executes arbitrary JavaScript in the page context. It is blocked in read-only mode but available otherwise.

**Validation applied:**
- Maximum length: 10000 characters
- Blocked patterns:
  - `document.cookie` — prevents cookie access
  - `localStorage`, `sessionStorage`, `indexedDB` — prevents storage access
  - `fetch`, `XMLHttpRequest`, `WebSocket` — prevents network requests
  - `eval`, `Function` — prevents dynamic code execution

**Important limitations:**
- The validator does NOT block `require`, `import`, `process`, or Node.js-specific keywords — these are not available in the browser page context anyway
- Page-side JavaScript can still perform actions like navigation, form submission, and DOM manipulation
- `evaluate` has the same power as a browser DevTools console — use with equivalent caution
- Always validate any data returned from `evaluate` before using it in subsequent operations
