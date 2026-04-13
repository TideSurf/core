# Troubleshooting

## Chrome not found

TideSurf looks for Chrome (or Chromium) in the standard installation paths for your operating system. If it can't find a browser binary, you'll see a `ChromeLaunchError`.

**Fix:** Set the `CHROME_PATH` environment variable to point to your Chrome executable, or pass `chromePath` in the launch options:

```typescript
const browser = await TideSurf.launch({
  chromePath: "/usr/bin/google-chrome-stable",
});
```

On macOS, the default path is usually `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`. On Linux, try `which google-chrome` or `which chromium-browser` to find it.

## CDP connection refused

This happens when Chrome launched successfully but TideSurf couldn't establish a WebSocket connection to the Chrome DevTools Protocol endpoint — usually because another process is already using the debugging port.

**Fix:** TideSurf retries automatically up to 3 times, so transient failures resolve on their own. If the error persists, check whether another Chrome instance or debugging tool is already bound to the same port. You can specify a different port in the launch options:

```typescript
const browser = await TideSurf.launch({
  port: 9223, // Default is 9222
});
```

## Auto-connect can't find Chrome

When using `TideSurf.connect()` or `--auto-connect`, you'll see a `CDPConnectionError` if TideSurf can't reach Chrome on the target port. This means Chrome either isn't running, or doesn't have remote debugging enabled.

**Fix:** Enable remote debugging in Chrome using one of these methods:

1. **Chrome 144+:** Navigate to `chrome://inspect#remote-debugging` and enable it. Chrome will show a permission dialog each time TideSurf connects.

2. **Any Chrome version:** Quit Chrome and relaunch it from the terminal with the remote debugging flag:

```bash
# macOS
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222

# Linux
google-chrome --remote-debugging-port=9222
```

3. **Custom port:** If you're using a non-default port, make sure to pass it:

```typescript
const browser = await TideSurf.connect({ port: 9333 });
```

```bash
tidesurf mcp --auto-connect --port 9333
```

**Note:** After connecting, you should see the "Chrome is being controlled by automated test software" banner in Chrome (Chrome 144+). This is expected and indicates the CDP session is active.

## Auto-connect: no page targets

If TideSurf finds Chrome but reports "no open page targets," it means Chrome is running with remote debugging but has no regular tabs open (e.g., only DevTools or extension pages).

**Fix:** Open at least one regular tab in Chrome before connecting.

## Timeouts

If operations like `navigate()` or `getState()` are timing out, the target page may be slow to load (heavy JavaScript, large media assets, or a slow server).

**Fix:** Increase the timeout globally through launch options, or accept that some pages are too slow and handle the `CDPTimeoutError` gracefully:

```typescript
const browser = await TideSurf.launch({
  timeout: 60000, // 60 seconds instead of the default
});
```

## Shadow DOM content missing

Shadow DOM is pierced automatically by default. If you're not seeing shadow DOM content in the output, verify that `pierce: true` is set (this is the default behavior). Custom elements that use closed shadow roots may not be accessible — this is a browser-level restriction, not a TideSurf limitation.

## Cross-origin iframes

Iframes that load content from a different origin are subject to the browser's same-origin policy and cannot be accessed by TideSurf. These appear in the output as:

```
[iframe: inaccessible]
```

This is a fundamental browser security boundary. Same-origin iframes are accessed and compressed normally.

## Empty or unexpected output

If `getState()` returns very little content or doesn't include elements you expect to see:

- **The page may not have finished loading.** Try adding a short delay before calling `getState()`, or wait for the page to settle with `await browser.getPage().waitForStable()`
- **Dynamic content may not have rendered yet.** Single-page apps that load content via JavaScript after the initial page load may need a moment for the framework to mount and render components
- **The token budget may be too low.** If you're using `maxTokens`, try increasing it or omitting it entirely to see the full output

## High token count

If the compressed output is larger than expected, the page likely has a complex, deeply nested DOM with many interactive elements. Consider using `maxTokens` to cap the output, which forces TideSurf to prioritize the most actionable elements and prune the rest.

## Common CDP connection errors

### "No open page targets found"

Chrome is running with remote debugging enabled, but has no regular tabs open (only DevTools or extension pages).

**Fix:** Open at least one regular tab in Chrome before connecting.

### "Protocol error: Invalid session"

The CDP session was interrupted, usually because Chrome crashed or was closed externally.

**Fix:** Restart Chrome and reconnect.

### Connection hangs indefinitely

Sometimes Chrome is unresponsive due to a frozen tab or extension conflict.

**Fix:**
1. Try closing all tabs except one blank tab
2. Disable extensions that might interfere with CDP
3. Restart Chrome with a fresh profile: `--user-data-dir=/tmp/tidesurf-profile`

### Port conflicts on 9222

Another process is already using port 9222.

**Fix:** Use a different port:

```typescript
const browser = await TideSurf.launch({ port: 9223 });
// or
const browser = await TideSurf.connect({ port: 9223 });
```

```bash
tidesurf mcp --port 9223
tidesurf inspect https://example.com --port 9223
```

## Chrome process leaks

If TideSurf crashes or is killed, Chrome processes might remain running.

**Fix on macOS/Linux:**
```bash
# Find Chrome processes with remote debugging
ps aux | grep "remote-debugging-port"

# Kill them manually
kill -9 <pid>
```

**Fix on Windows:**
```powershell
# Find Chrome with debugging port
Get-Process chrome | Where-Object {$_.CommandLine -like "*remote-debugging-port*"}

# Stop the process
Stop-Process -Id <pid>
```

## Permission denied errors

### Upload/download

```
File "/path/to/file" is outside allowed file access roots
```

**Fix:** Files must be within the configured `fileAccessRoots` (defaults to working directory + temp directory).

```typescript
const browser = await TideSurf.launch({
  fileAccessRoots: [process.cwd(), "/allowed/path"],
});
```

### Clipboard access

```
clipboard_read is not available in read-only mode
```

**Fix:** Clipboard tools are disabled in read-only mode. Launch without `readOnly: true` to use them.
