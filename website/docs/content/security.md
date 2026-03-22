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
| URLs | Must be `http:` or `https:` protocol |
| CSS selectors | Blocked characters: `{`, `}`, `;`, `//`, `<!--` |
| JavaScript expressions | Blocked keywords: `require`, `import`, `process`, `child_process`, `__dirname`, `__filename` |
| Element IDs | Must match `[LBIS]\d+` pattern |
| File paths | Must resolve inside `fileAccessRoots` |
| Numeric inputs | Must be positive integers/numbers where required |

## CDP connection security

- TideSurf connects to Chrome over a local WebSocket. The CDP port (default 9222) should not be exposed to untrusted networks.
- When using `TideSurf.connect()`, TideSurf attaches to whatever Chrome instance is listening. It does not verify identity — ensure only your Chrome is on the expected port.
- `close()` on a connected (not launched) instance only disconnects CDP. It never kills the browser process.

## Evaluate safety

The `evaluate` tool executes arbitrary JavaScript in the page context. It is blocked in read-only mode but available otherwise. The expression validator blocks common Node.js escape patterns but cannot prevent all browser-side effects. Use with the same caution as a browser DevTools console.
