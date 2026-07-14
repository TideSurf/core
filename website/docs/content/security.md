# Security model

TideSurf uses Chrome's DevTools Protocol with browser-level power. Treat its session boundary as part of your application security model.

## Read-only mode

`readOnly: true` limits the agent tool surface to observation. It removes:

- Page navigation and modification (`navigate`, `click`, `type`, `select`, `scroll`)
- JavaScript execution (`evaluate`)
- Clipboard access (`clipboard_read`, `clipboard_write`)
- File operations (`upload`, `download`)
- Tab creation and closure (`new_tab`, `close_tab`)

Observation tools remain: `get_state`, `extract`, `list_tabs`, `switch_tab`, `search`, and `screenshot`.

Read-only mode is enforced by the tool executor and MCP server. Direct SDK access through `browser.getPage()` bypasses that tool guard, so the host application must control `SurfingPage` methods. `TideSurf.navigate()` does enforce read-only mode at the SDK level.

## Filesystem confinement

`upload` and `download` stay inside `fileAccessRoots`, which defaults to the current working directory and OS temp directory. Expand it explicitly:

```typescript
const browser = await TideSurf.launch({
  fileAccessRoots: [process.cwd(), "/shared/fixtures"],
});
```

Paths outside these roots are rejected with a `ValidationError`.

## Input validation

Tool inputs are validated before execution:

| Input | Validation |
|---|---|
| URLs | Must be `http:` or `https:` protocol; private IP addresses (localhost, 127.x, 10.x, 192.168.x) are blocked |
| CSS selectors | Max length 1000 characters; dangerous patterns blocked |
| JavaScript expressions | Max length 10000 characters; blocked patterns: `document.cookie`, `localStorage`, `sessionStorage`, `indexedDB`, `fetch`, `XMLHttpRequest`, `WebSocket`, `eval`, `Function` |
| Element IDs | Must match `[LBISFTD]\d+` pattern |
| File paths | Must resolve inside `fileAccessRoots` |
| Numeric inputs | Must be positive integers/numbers where required |

## CDP connection security

- Keep the local CDP WebSocket port, `9222` by default, away from untrusted networks.
- `TideSurf.connect()` attaches to the Chrome instance listening on the target port without identity verification. Control access to that port.
- `close()` only disconnects a connected instance. It does not stop that Chrome process.

## Computed visibility and element state

Before serialization, TideSurf checks `opacity`, `visibility`, `display`, `clip-path`, and `pointer-events`. Hidden or unusable elements stay out of the agent surface.

The visibility pass temporarily injects `data-os-state` attributes. Page JavaScript could race the DOM walk through a `MutationObserver` and spoof them. TideSurf clears all such attributes before each `getState()` pass, removing stale values before the fresh walk.

`getState({ includeHidden: true })` bypasses visibility filtering for debugging hidden menus, lazy content, and off-screen elements. Keep it out of production agent loops; it exposes non-interactive DOM and raises token use.

## Evaluate safety

`evaluate` runs arbitrary JavaScript in the page context and stays unavailable in read-only mode.

**Validation applied:**
- Maximum length: 10000 characters
- Blocked patterns:
  - `document.cookie`: prevents cookie access
  - `localStorage`, `sessionStorage`, `indexedDB`: prevents storage access
  - `fetch`, `XMLHttpRequest`, `WebSocket`: prevents network requests
  - `eval`, `Function`: prevents dynamic code execution

**Important limitations:**
- The validator does not block `require`, `import`, `process`, or Node.js-specific keywords; they are unavailable in the browser page context
- Page-side JavaScript can still perform actions like navigation, form submission, and DOM manipulation
- `evaluate` has browser DevTools console power and needs the same caution
- Validate returned data before using it in later operations
