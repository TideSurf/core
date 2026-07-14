# Error handling

TideSurf exposes typed errors, avoiding message parsing. Every type extends `TideSurfError`, which extends the standard `Error` class.

## Error types

```typescript
import {
  TideSurfError,        // Base class for all TideSurf errors
  CDPConnectionError,   // Could not establish a CDP connection
  CDPTimeoutError,      // A CDP operation exceeded its timeout
  ChromeLaunchError,    // Chrome binary failed to start
  ElementNotFoundError, // The given element ID doesn't exist on the page
  NavigationError,      // Navigation to a URL failed
  ValidationError,      // Input validation failed (e.g. invalid URL format)
} from "@tidesurf/core";
```

## Catching specific errors

Catch the failure at the useful level:

```typescript
try {
  await browser.navigate("https://example.com");
  const page = browser.getPage();
  await page.click("B1");
} catch (err) {
  if (err instanceof ElementNotFoundError) {
    // The page changed. Read fresh state before retrying.
    const freshState = await browser.getState();
    // ... find the right element in freshState.content and try again
  } else if (err instanceof CDPTimeoutError) {
    // The page may be unresponsive or loading a heavy resource.
  } else if (err instanceof NavigationError) {
    // Check DNS, URL validity, and the response status.
  }
}
```

## When each error occurs

| Error | Common causes | Recovery approach |
|---|---|---|
| `ChromeLaunchError` | Chrome binary not found, insufficient permissions, or port already in use | Check `CHROME_PATH`, verify Chrome is installed, try a different port |
| `CDPConnectionError` | Chrome launched but CDP WebSocket connection failed | TideSurf retries up to 3 times |
| `CDPTimeoutError` | Navigation or another CDP operation exceeded its timeout | Raise the timeout or skip an unresponsive page |
| `NavigationError` | DNS failure, invalid URL, or server error (4xx/5xx) | Validate the URL, check network connectivity, or handle as a dead link |
| `ElementNotFoundError` | The element ID from a previous `getState()` doesn't match the current DOM | The page changed since the last state snapshot. Call `getState()` again to get fresh IDs |
| `ValidationError` | Invalid input passed to a TideSurf method (e.g. empty string for URL) | Fix the input before retrying |

## Automatic retry behavior

TideSurf retries transient startup failures:

- **`launch()` and `connect()`** retry `CDPConnectionError` and `ChromeLaunchError` up to 3 times with exponential backoff
- **`CDPTimeoutError`** is not retried; an unresponsive page or looping page script usually needs a different response

Add an application-level retry loop for any other recovery policy.
