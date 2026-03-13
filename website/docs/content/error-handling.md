# Error handling

TideSurf uses typed error classes so you can catch and handle specific failure modes without parsing error messages. Every error extends the base `TideSurfError` class, which itself extends `Error`, so standard try/catch patterns work as expected.

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

Each error type lets you respond differently depending on what went wrong, rather than treating all failures the same way:

```typescript
try {
  await browser.navigate("https://example.com");
  const page = browser.getPage();
  await page.click("B1");
} catch (err) {
  if (err instanceof ElementNotFoundError) {
    // The element ID from a previous getState() call is no longer valid,
    // likely because the page content changed — re-fetch state and retry
    const freshState = await browser.getState();
    // ... find the right element in freshState.xml and try again
  } else if (err instanceof CDPTimeoutError) {
    // The operation took too long — the page may be unresponsive
    // or loading a heavy resource
  } else if (err instanceof NavigationError) {
    // The URL couldn't be reached — could be a DNS issue,
    // an invalid URL, or a page that returned an error status
  }
}
```

## When each error occurs

| Error | Common causes | Recovery approach |
|---|---|---|
| `ChromeLaunchError` | Chrome binary not found, insufficient permissions, or port already in use | Check `CHROME_PATH`, verify Chrome is installed, try a different port |
| `CDPConnectionError` | Chrome launched but CDP WebSocket connection failed | Usually transient — TideSurf retries automatically up to 3 times |
| `CDPTimeoutError` | An operation (navigation, evaluation, etc.) exceeded its timeout | The page may be hung or loading very slowly; consider increasing the timeout or skipping the page |
| `NavigationError` | DNS failure, invalid URL, or server error (4xx/5xx) | Validate the URL, check network connectivity, or handle as a dead link |
| `ElementNotFoundError` | The element ID from a previous `getState()` doesn't match the current DOM | The page changed since the last state snapshot — call `getState()` again to get fresh IDs |
| `ValidationError` | Invalid input passed to a TideSurf method (e.g. empty string for URL) | Fix the input before retrying |

## Automatic retry behavior

TideSurf automatically retries certain operations that are likely to succeed on a subsequent attempt:

- **`launch()` and `connect()`** retry up to 3 times with exponential backoff when they encounter `CDPConnectionError` or `ChromeLaunchError`, since these are often caused by transient timing issues during browser startup
- **`CDPTimeoutError`** is never retried automatically, because a timeout usually indicates a deeper problem (unresponsive page, infinite loop in page JavaScript) where retrying would just waste time

If you need custom retry logic beyond what TideSurf provides, wrap calls in your own retry loop and catch the specific error types you want to handle.
