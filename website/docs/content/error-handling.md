# Error handling

TideSurf exports typed domain errors for common failures. Unrelated page and CDP failures retain their original `Error` type. Every exported TideSurf error extends `TideSurfError`, which extends the standard `Error` class.

## Error types

```typescript
import {
  TideSurfError,
  ActionCommittedError,
  CDPConnectionError,
  CDPTimeoutError,
  ChromeLaunchError,
  ElementNotFoundError,
  NavigationError,
  ValidationError,
  ReadOnlyError,
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
    const freshState = await browser.readPage();
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
| `CDPTimeoutError` | A non-navigation CDP operation exceeded its timeout | Raise the timeout or skip an unresponsive page |
| `NavigationError` | DNS failure, CDP navigation failure, or load timeout | Check network connectivity or handle the target as a dead link |
| `ElementNotFoundError` | The element ID from a previous `readPage()` result no longer matches the current DOM | The page changed since the last page read. Call `readPage()` again to get fresh IDs |
| `ActionCommittedError` | A mutation completed, then page-stability confirmation failed | Do not repeat the mutation. Call `readPage()` to inspect the result |
| `ValidationError` | Invalid input passed to a TideSurf method, including a malformed or forbidden URL | Fix the input before retrying |
| `ReadOnlyError` | A method would navigate, mutate, evaluate, access files/clipboard, or mutate tabs | Use an allowed observation method or start a separate writable session |

## Automatic retry behavior

TideSurf retries only transient browser-readiness failures during managed setup. Missing executables, explicit port collisions, invalid input, policy failures, and fixed attach failures return immediately. Browser setup cleans partial CDP clients, targets, processes, and temporary profiles before returning an error.

Direct SDK mutation methods throw `ActionCommittedError` when the mutation succeeded but its follow-up page check failed. CLI and MCP tool calls convert it to a successful warning so an agent does not repeat the action.

Add an application-level retry loop only when the operation is safe to repeat. Never retry a stale element ID against a guessed replacement; read fresh state first.
