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
  cdpPort: 9223, // Default is 9222
});
```

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

```xml
<iframe status="inaccessible" />
```

This is a fundamental browser security boundary. Same-origin iframes are accessed and compressed normally.

## Empty or unexpected output

If `getState()` returns very little content or doesn't include elements you expect to see:

- **The page may not have finished loading.** Try adding a short delay before calling `getState()`, or navigate with `{ waitUntil: "networkidle" }` if available
- **Dynamic content may not have rendered yet.** Single-page apps that load content via JavaScript after the initial page load may need a moment for the framework to mount and render components
- **The token budget may be too low.** If you're using `maxTokens`, try increasing it or omitting it entirely to see the full output

## High token count

If the compressed output is larger than expected, the page likely has a complex, deeply nested DOM with many interactive elements. Consider using `maxTokens` to cap the output, which forces TideSurf to prioritize the most actionable elements and prune the rest.
