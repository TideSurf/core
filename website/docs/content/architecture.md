# Architecture

TideSurf has one browser core, one tool registry, and thin transport adapters. The CLI adds a local session process so browser state survives separate shell invocations.

## Runtime layout

```text
shell command ── local socket / named pipe ── session daemon ──┐
                                                               │
SDK caller ────────────────────────────────────────────────────┤
                                                               ├─ TideSurf ─ CDP ─ Chromium
MCP client ── stdio ── MCP adapter ────────────────────────────┘
                              │
                    canonical tool registry
```

All 18 tools have one `ToolSpec`. Each spec holds its JSON schema, read-only eligibility, CLI argument metadata, output kind, validation, and handler. The registry generates SDK definitions, executor dispatch, CLI help, MCP registration, and unknown-tool messages.

MCP adds only transport behavior: stdio registration, schema conversion, tolerance for omitted call arguments, PNG image blocks, `isError`, and the `launch_browser` lifecycle tool.

## Stateful CLI sessions

Each session name maps to one background process. The default name is `default`.

```text
tidesurf navigate … ─┐
tidesurf get_state ──┼─ session "default" ─ one TideSurf instance ─ one browser
tidesurf click B1 ───┘
```

The daemon keeps the `TideSurf` instance in memory. This preserves:

- active tab
- open tab connections
- exact ID-to-DOM maps
- immutable URL, filesystem, browser, and read-only policy

Browser startup, tools, and stop requests enter one serialized queue. Concurrent clients cannot interleave browser mutations or downloads. Health and status requests bypass that queue so a long tool cannot make a live session appear dead.

The transport uses a Unix domain socket on Unix and a named pipe on Windows. Session metadata lives in a private runtime directory. Each session receives a random handshake secret and protocol version. Atomic state files, a startup lock, PID checks, and socket probes handle simultaneous starts and stale files.

The CLI bootstrap defers session and browser modules until a command needs them. A warm command sends its requested operation as the first authenticated socket request. TideSurf retries only stale-endpoint failures detected before that request is sent; an ambiguous post-send failure returns to the caller without replaying a possible mutation.

Sessions have no idle timeout. `stop` ends the daemon and its browser relationship, and it terminates a recorded daemon process whose socket has vanished.

This state-preserving background-process model follows the [Chrome DevTools CLI session design](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/cli.md).

## Browser ownership

Two SDK methods have strict roles:

- `TideSurf.launch()` starts a process, owns it, and removes its temporary profile after exit.
- `TideSurf.connect()` attaches to an existing CDP endpoint and only disconnects in `close()`.

The CLI defaults to managed launch. `--auto-connect` adds ordered discovery before launch. `--connect-only` uses discovery without fallback.

Managed launch uses an isolated profile by default and `--remote-debugging-port=0` unless a port is explicit. Chrome writes the selected port and browser WebSocket path to `DevToolsActivePort`. TideSurf connects to that endpoint instead of fabricating a WebSocket URL.

Browser setup is transactional. Profile preparation and every later stage roll back through the same typed failure path. A failed stage closes any partial CDP client or target, terminates an owned process, drains its pipes, and removes an owned temporary profile. Startup errors include a bounded tail of Chrome stderr. Startup retries only transient readiness failures.

Shutdown is idempotent. It disconnects unique pages in parallel, waits for an owned process to exit, escalates termination when required, then removes the profile.

## Executable and endpoint discovery

Executable resolution follows one path:

1. explicit `chromePath`
2. `CHROME_PATH`
3. supported names on `PATH`
4. platform install locations

Channel priority is stable, Beta, Dev, Canary, Chromium. Platform locations include macOS user applications and Windows `LOCALAPPDATA`. Edge and Brave do not enter automatic resolution.

Without an explicit endpoint, auto-connect checks a supported Chrome profile `DevToolsActivePort`, then a conventional local endpoint. An explicit endpoint is pinned and never falls back to a different running browser: connect-only fails when it does not answer, and auto-connect launches a fresh local browser for a local endpoint or fails for a remote one.

## Browser-to-agent data flow

```text
rendered DOM
  → bounded non-mutating node preflight
  → one DOMSnapshot capture
  → snapshot decode and semantic classification
  → viewport/full-DOM selection
  → mode filter
  → token pruning
  → text serialization and ID map
```

Page reads do not add marker attributes or call `DOM.getDocument`. A bounded, read-only preflight counts DOM nodes and reads viewport metadata before `DOMSnapshot.captureSnapshot`. The snapshot supplies the flattened document, layout bounds, selected computed styles, and current form state in one response.

The decoder builds the page tree and ID map without changing page content. Normal viewport mode removes offscreen descendants even when a visible structural container spans the page. `includeHidden: true` skips hidden-node and viewport filtering for full-DOM debugging. Snapshot geometry cannot prove paint-order hit testing, so page reads omit `obscured` instead of guessing.

Snapshot decoding caches each ancestor clip region once and skips descendants of hidden subtrees that CSS descendants cannot override. Interactive and minimal filters use post-order traversal. Serialization shares text memoization. Token pruning retains useful children inside oversized containers, clones only changed paths, and keeps source order.

## Agent-to-browser data flow

```text
tool lookup → read-only gate → input validation → handler
          → resolve one current ID → CDP action → release handle
```

Element actions resolve once through a timed resolve/use/release boundary. Missing current IDs become `ElementNotFoundError`; unrelated CDP failures keep their original type.

After resolution, mutating requests share one uncertainty boundary. A timeout or disconnect after dispatch returns `ActionCommittedError` instead of a retryable failure for interaction, scrolling, evaluation, clipboard write, file selection, and tab mutation. Deterministic validation, resolution, and page-side errors remain failures.

Stability waits use independent page observers with quiet and hard deadlines. Concurrent waits do not share page-global timer state.

Navigation and download waits observe the same disconnect boundary. They stop promptly when the browser or target closes. `switch_tab` reconnects a deliberately disconnected page client and evicts a stale cache entry when the target no longer accepts a connection.

Element screenshots resolve the current ID once and capture its border box with beyond-viewport capture enabled. All screenshot paths share the same dimension and pixel-area limits.

Clipboard permission changes serialize per browser endpoint within one TideSurf process, so its page connections cannot race while independent browsers remain independent. A timed-out permission reset keeps that process-local endpoint queue reserved until Chrome settles the raw command. One download may own a `SurfingPage` connection at a time; separate clients attached to the same target do not share this lock. Timed-out setup and restore commands keep the connection reserved until their raw replies settle. A completed transfer keeps its result even when final cleanup fails; uncertain trigger failures use the committed-action path to prevent unsafe retries.

## Read-only boundary

Read-only policy is enforced in the registry, executor, TideSurf lifecycle and tab methods, and every relevant `SurfingPage` method. `getPage()` does not create a bypass. `switch_tab` stays readable because it changes the observation target without changing page content.
