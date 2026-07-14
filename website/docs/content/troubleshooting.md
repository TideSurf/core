# Troubleshooting

## Chrome not found

`ChromeLaunchError` usually means TideSurf could not find a Chrome or Chromium binary. Set `CHROME_PATH` or pass `chromePath`:

```typescript
const browser = await TideSurf.launch({
  chromePath: "/usr/bin/google-chrome-stable",
});
```

The usual macOS path is `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`. On Linux, `which google-chrome` or `which chromium-browser` prints the installed path.

## CDP connection refused

Chrome started, but its CDP WebSocket did not accept the connection. TideSurf retries three times. A persistent failure often points to another process on the debugging port. Choose another port:

```typescript
const browser = await TideSurf.launch({ port: 9223 });
```

## Auto-connect can't find Chrome

`TideSurf.connect()` and `--auto-connect` need a running Chrome with remote debugging enabled. Chrome 144+ uses `chrome://inspect#remote-debugging` and shows a permission dialog for each connection. Any supported Chrome can launch with a debugging flag:

```bash
# macOS
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222

# Linux
google-chrome --remote-debugging-port=9222
```

Pass the same custom port to TideSurf:

```typescript
const browser = await TideSurf.connect({ port: 9333 });
```

```bash
tidesurf mcp --auto-connect --port 9333
```

The “Chrome is being controlled by automated test software” banner confirms an active CDP session.

## Auto-connect: no page targets

Chrome has remote debugging enabled but no regular page tab. Open one normal tab before connecting; DevTools and extension pages do not count.

## Timeouts

Heavy scripts, media, or slow servers can push `navigate()` and `getState()` past the default timeout. Raise it at launch and handle `CDPTimeoutError` in the calling application:

```typescript
const browser = await TideSurf.launch({ timeout: 60000 });
```

## Shadow DOM content missing

TideSurf pierces open shadow roots by default. Confirm `pierce: true` remains enabled. Closed roots stay private to the browser and may not be available.

## Cross-origin iframes

The browser same-origin policy blocks iframe content from another origin. TideSurf reports the boundary as:

```text
[iframe: inaccessible]
```

Same-origin iframe content is compressed normally.

## Empty or unexpected output

Three common causes cover most sparse results:

- The page is still settling. Use `await browser.getPage().waitForStable()` before `getState()`.
- A client-side app has not rendered its dynamic content yet. Allow the framework to mount.
- `maxTokens` is too low. Raise it or remove it to inspect the complete compressed output.

## High token count

Pages with many controls or deeply nested DOM trees can still produce large output. Add `maxTokens` so TideSurf keeps the most actionable content first.

## Common CDP connection errors

**“No open page targets found”**

Open a regular Chrome tab. A browser containing only DevTools or extension pages has no usable target.

**“Protocol error: Invalid session”**

Chrome closed, crashed, or interrupted the CDP session. Restart Chrome and reconnect.

**Connection hangs indefinitely**

A frozen tab or extension can block Chrome. Keep one blank tab open, disable suspect extensions, or restart with a fresh profile:

```bash
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/tidesurf-profile
```

**Port conflicts on 9222**

Use the same alternate port on Chrome and TideSurf:

```typescript
const browser = await TideSurf.launch({ port: 9223 });
// or: await TideSurf.connect({ port: 9223 })
```

```bash
tidesurf mcp --port 9223
tidesurf inspect https://example.com --port 9223
```

## Chrome process leaks

A crash or forced exit can leave a launched Chrome process behind. Find the remote-debugging process and stop its PID:

```bash
ps aux | grep "remote-debugging-port"
kill -9 <pid>
```

Windows PowerShell:

```powershell
Get-Process chrome | Where-Object {$_.CommandLine -like "*remote-debugging-port*"}
Stop-Process -Id <pid>
```

## Permission denied errors

**Upload/download**

```text
File "/path/to/file" is outside allowed file access roots
```

Uploads and custom download directories must resolve inside `fileAccessRoots`, which defaults to the working directory and OS temp directory:

```typescript
const browser = await TideSurf.launch({
  fileAccessRoots: [process.cwd(), "/allowed/path"],
});
```

**Clipboard access**

```text
clipboard_read is not available in read-only mode
```

Clipboard tools stay disabled in read-only sessions. Use a regular session only for a trusted workflow that needs clipboard access.
