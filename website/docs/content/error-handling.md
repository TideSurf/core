# Error handling

TideSurf exposes typed errors, avoiding message parsing. Every type extends `TideSurfError`, which extends the standard `Error` class.

## Error types

```typescript
import {
  TideSurfError,        // Base class for all TideSurf errors
  CDPConnectionError,   // Could not establish a CDP connection
  CDPTimeoutError,      // A CDP operation exceeded its timeout
  ChromeLaunchError,    // Chrome binary failed to start
  ElementNotFoundError, // The given element ID is absent from the page map
  NavigationError,      // Navigation to a URL failed
  ValidationError,      // Input validation failed (e.g. invalid URL format)
  ReadOnlyError,        // Session policy forbids this operation
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
    // Check DNS, URL validity, and network connectivity.
  }
}
```

## When each error occurs

| Error | Common causes | Recovery approach |
|---|---|---|
| `ChromeLaunchError` | Chrome binary not found, insufficient permissions, or explicit port already in use | Check `CHROME_PATH`, verify Chrome is installed, or remove the fixed port |
| `CDPConnectionError` | The requested CDP endpoint is unavailable or setup failed | Check attach settings or start a new managed browser |
| `CDPTimeoutError` | Navigation or another CDP operation exceeded its timeout | Raise the timeout or skip an unresponsive page |
| `NavigationError` | DNS failure, invalid URL, CDP failure, or load timeout | Validate the URL, check network connectivity, or handle as a dead link |
| `ElementNotFoundError` | The element ID from a previous `getState()` no longer matches the current DOM | The page changed since the last state snapshot. Call `getState()` again to get fresh IDs |
| `ValidationError` | Invalid input passed to a TideSurf method (e.g. empty string for URL) | Fix the input before retrying |
| `ReadOnlyError` | A method would navigate, mutate, evaluate, access files/clipboard, or mutate tabs | Use an allowed observation method or start a separate writable session |

## Automatic retry behavior

TideSurf retries only transient browser-readiness failures during managed setup. Missing executables, explicit port collisions, invalid input, policy failures, and fixed attach failures return immediately. Browser setup cleans partial CDP clients, targets, processes, and temporary profiles before returning an error.

Add an application-level retry loop only when the operation is safe to repeat. Never retry a stale element ID against a guessed replacement; read fresh state first.
