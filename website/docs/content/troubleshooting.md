# Troubleshooting

Start with the exit code and the selected session:

```bash
tidesurf --session default status
tidesurf --session default help
```

Exit code `2` means usage, `3` session or browser startup, `4` tool execution, and `5` daemon transport or protocol.

## Browser executable not found

TideSurf searches an explicit path, `CHROME_PATH`, `PATH`, then platform install locations. It checks Chrome stable, Beta, Dev, Canary, then Chromium unless `--channel` selects one.

```bash
tidesurf --chrome-path /usr/bin/google-chrome get_state
# or
CHROME_PATH=/usr/bin/chromium tidesurf get_state
```

SDK equivalent:

```typescript
const browser = await TideSurf.launch({
  chromePath: "/usr/bin/google-chrome",
});
```

The path must name a regular executable file. Common locations include:

- macOS: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
- macOS user install: `~/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
- Linux: `/usr/bin/google-chrome`, `/usr/bin/chromium`, `/snap/bin/chromium`
- Windows: Chrome directories under `%LOCALAPPDATA%` or `%PROGRAMFILES%`

Pass Edge or Brave through `--chrome-path`; automatic detection intentionally excludes them. TideSurf does not download a missing browser.

## Session has different startup options

Browser and security policy is immutable after a named session starts. A conflicting flag produces a session error.

Stop that session or choose another name:

```bash
tidesurf --session default stop
tidesurf --session default --read-only start

# Keep the old session and start another policy:
tidesurf --session audit --read-only get_state
```

You do not need to repeat startup flags on later calls. Repeating only matching standalone flags also succeeds; the daemon compares the values you explicitly supply and keeps unrelated policy. Browser-selection flags must resolve to the stored mode. If you repeat `--file-access-root`, supply the complete stored root list.

## Session does not start

TideSurf uses a startup lock, PID check, private state file, and local socket or named pipe. It removes stale state when the recorded process is gone.

If startup still fails:

1. Run `tidesurf status`.
2. Run `tidesurf stop`; stop is safe when no session exists.
3. Retry the tool command.
4. Read the daemon log path included in the error.

A protocol-version or TideSurf-version mismatch requires stopping the old session before using the new CLI build.

Managed launch failures include the final bounded portion of Chrome stderr. Use it to identify missing system libraries, profile permission failures, or unsupported flags without searching an unbounded browser log.

## Connect-only cannot find Chrome

`--connect-only` never launches. Without an explicit endpoint, it checks a supported Chrome profile `DevToolsActivePort` and the conventional local endpoint on port `9222`.

Chrome 144 profile attachment may require approval at `chrome://inspect#remote-debugging`. For a manual fixed endpoint, launch Chrome with a non-default profile:

```bash
# macOS
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/tidesurf-manual-profile

# Linux
google-chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/tidesurf-manual-profile
```

Then attach:

```bash
tidesurf --connect-only --host 127.0.0.1 --port 9222 get_state
```

[Chrome 136+ does not honor remote debugging flags against its default profile directory](https://developer.chrome.com/blog/remote-debugging-port). Keep the explicit non-default `--user-data-dir`. [Chrome agent configuration](https://developer.chrome.com/docs/devtools/agents/get-started/configuration) covers current profile approval and endpoint setup.

## Auto-connect launches unexpectedly

`--auto-connect` tries, in order:

1. explicit `--browser-url` or host/port
2. supported Chrome profile `DevToolsActivePort`
3. conventional local CDP endpoint
4. managed local launch

Use `--connect-only` when launch is never acceptable. A failed remote-host endpoint does not fall back to local launch.

## Fixed port is already in use

Managed launch uses an ephemeral port by default. Remove `--port` unless another process needs a predictable endpoint.

An explicit launch port fails on collision instead of attaching to or replacing the existing listener. Choose another port or use attach mode intentionally.

```bash
tidesurf --port 9333 start
# or attach to an existing endpoint
tidesurf --connect-only --port 9222 get_state
```

## Browser has no page target

An attached Chrome instance must contain a regular page target. Open a normal tab and retry. DevTools, extension, and background targets do not count.

## Element ID is stale

IDs refer to the exact in-memory map created by page state. Navigation and dynamic DOM updates can invalidate it. TideSurf rejects a stale ID rather than clicking a replacement.

```bash
tidesurf get_state
# select a current ID from this output, then act
tidesurf click B3
```

Do not increment or guess IDs after a failure.

If a tab was closed outside TideSurf, `switch_tab` rejects its old tab ID immediately and removes the stale connection. Run `list_tabs` and choose a current tab.

## State omits expected content

Check these settings:

- `get_state` uses viewport filtering by default. Add `--full-page` for visible content outside the viewport.
- `--mode interactive` excludes passive text. Use `--mode full`.
- A low `--max-tokens` value prunes lower-priority content. Raise or remove it.
- The application may still be rendering. Retry after it settles.
- Open shadow roots are readable; closed roots remain unavailable.
- Cross-origin iframe content may remain inaccessible.
- Page reads do not infer whether another painted element covers a control. Use a screenshot when overlay state matters.

Use `--include-hidden` only when debugging the full DOM. It includes hidden nodes and disables viewport filtering.

## Read-only tool fails

Read-only sessions allow only `get_state`, `extract`, `list_tabs`, `switch_tab`, `search`, and `screenshot`. Other tools return a tool failure with exit code `4`.

Start a separate non-read-only session when the workflow genuinely needs mutation:

```bash
tidesurf --session audit stop
tidesurf --session edit navigate https://example.com
```

## Upload or download path is rejected

The path lies outside the configured filesystem boundary. Defaults allow the current working directory and OS temporary directory.

```bash
tidesurf --session files \
  --file-access-root /absolute/shared-fixtures \
  start
```

`--file-access-root` is a startup option. Stop the session before changing its roots.

Only one download can run through a `SurfingPage` connection at a time. A second call on that connection fails instead of sharing browser download state; separate clients attached to the same target do not share this lock. A path that resolves outside the allowed roots is rejected before browser download setup.

A browser or target disconnect stops the download wait. The trigger may already have clicked, so an uncertain trigger returns the committed-action warning path. Inspect session and page state instead of retrying the click. A completed transfer can also use that path when final browser-policy cleanup fails.

## Screenshot output is unreadable

Without `--output`, TideSurf prints an absolute path to a temporary PNG. `--output -` writes raw PNG bytes and should be redirected:

```bash
tidesurf screenshot --output - > page.png
```

Do not expect JSON or terminal text on stdout in raw-byte mode.

Element and full-page captures fail above 16,384 px on either side or 12,000,000 total pixels. Capture the viewport, target a smaller element, or reduce page dimensions.

## MCP dependencies are missing

MCP uses optional dependencies. Install them when an installation omits optional packages:

```bash
npm install @modelcontextprotocol/sdk zod
# or
bun add @modelcontextprotocol/sdk zod
```

Then run `tidesurf mcp`. The direct CLI and SDK do not need MCP packages.

## Stop leaves Chrome open

`stop` leaves an attached browser open by design. It terminates only Chromium launched and owned by that TideSurf session, then disconnects CDP.

If an owned browser survived an external hard kill of the daemon, identify the process by its TideSurf user data directory or remote-debugging argument before terminating it. Do not kill unrelated Chrome processes.

## Operation timeout

Raise the session timeout for slow startup or heavy pages:

```bash
tidesurf --session slow --timeout 60000 navigate https://example.com
```

For an existing session, choose a new name or stop it before changing the timeout.

Timeouts must be positive whole milliseconds no greater than 2,147,483,647. The CLI reserves time for sequential phases and transport cleanup, then rejects a computed request budget above 1,073,741,823 ms.
