# Security model

Chrome DevTools Protocol can read and change everything available to the attached browser profile. Treat a TideSurf session like a browser automation process with that profile's authority.

## Prefer isolated managed sessions

The default CLI mode launches headless Chromium with a temporary profile and ephemeral local debugging port. This separates agent cookies, storage, extensions, and browsing history from a personal profile.

`--user-data-dir` and `--auto-connect` can expose an existing profile. Use them only when the workflow needs that identity. `--connect-only` avoids accidental local launch but does not reduce the authority of the attached endpoint.

TideSurf never downloads a browser. It automatically selects only Chrome stable, Beta, Dev, Canary, and Chromium. Edge and Brave require an explicit path.

## Read-only mode

`readOnly: true` or CLI `--read-only` allows six observation tools:

- `get_state`
- `extract`
- `list_tabs`
- `switch_tab`
- `search`
- `screenshot`

It rejects:

- navigation: `navigate`
- page interaction: `click`, `type`, `select`, `scroll`
- arbitrary JavaScript: `evaluate`
- clipboard access: `clipboard_read`, `clipboard_write`
- filesystem access: `upload`, `download`
- tab mutation: `new_tab`, `close_tab`

Enforcement happens in the tool registry, executor, MCP adapter, `TideSurf` methods, and `SurfingPage`. A page returned by `getPage()` inherits the policy. `switch_tab` remains available because it only changes the observation target.

CLI session policy is immutable. A later invocation cannot weaken a running read-only session. Stop it or use another session name.

## Evaluate is arbitrary JavaScript

`evaluate` runs arbitrary JavaScript with page DevTools authority. It can read page data, change the DOM, navigate, submit forms, call page-accessible network APIs, and invoke application code.

TideSurf validates expression shape and size. It does not implement a JavaScript sandbox or a bypassable keyword denylist. Do not expose `evaluate` to an untrusted model or user. Use read-only mode to remove it.

## URL policy

Navigation accepts HTTP(S) and `about:` URLs. For network URLs, it rejects literal loopback, private, and link-local hosts by default. It also rejects the special-use `localhost` domain and its subdomains.

Opt in only for trusted networks:

```typescript
const browser = await TideSurf.launch({
  allowLocalhost: true,
  // allowPrivateHosts: true,
});
```

CLI equivalents are `--allow-localhost` and `--allow-private-hosts`. `allowPrivateHosts` also permits loopback.

The check validates the requested URL string. It does not resolve public hostnames, prevent DNS rebinding, or verify every redirect destination. A loaded page and arbitrary `evaluate` code still operate under Chromium networking rules. Treat the flags as an input guard, not a network sandbox; enforce outbound network policy outside TideSurf when SSRF resistance matters.

## Filesystem boundary

Uploads and download destinations must resolve inside `fileAccessRoots`. Omit the SDK option to allow the current working directory and OS temporary directory. Pass `fileAccessRoots: []` to disable SDK uploads and downloads.

```typescript
const browser = await TideSurf.launch({
  fileAccessRoots: [process.cwd(), "/absolute/shared-fixtures"],
});
```

The CLI flag `--file-access-root` is repeatable. Paths outside the configured roots fail before browser interaction. Keep roots narrow; an allowed root grants the agent access to files inside it.

## Local session transport

The stateful CLI listens on a Unix domain socket or Windows named pipe, not a TCP port. It stores metadata in a private runtime directory and authenticates each request with a random secret. Protocol versions prevent incompatible clients from reusing old state.

This protects against accidental cross-session calls on the same host. It does not defend a session from another process already running with the same operating-system account and permission to read that account's files.

## CDP endpoint security

Do not expose a Chrome debugging endpoint to an untrusted network. CDP has no application-level TideSurf authorization.

- Managed launch binds locally and uses an isolated profile.
- `TideSurf.connect()` attaches to the specified host and port without browser identity verification.
- Closing an attached TideSurf instance leaves the external browser running.
- A failed remote attach never triggers a local browser launch.

Chrome 136+ ignores remote debugging flags against its default data directory. Use a non-default `--user-data-dir` for manual fixed-port launch. Chrome 144 profile attachment may require approval at `chrome://inspect#remote-debugging`.

## Hidden and offscreen DOM

Normal state filters CSS-hidden, `hidden`, `aria-hidden`, and offscreen content. `includeHidden: true` is a full-DOM debugging override. It includes hidden nodes and disables viewport filtering.

Full-DOM output can reveal text and controls not intended for the visible interface and can increase token use sharply. Keep the override out of routine autonomous loops.

## Clipboard and downloads

Clipboard tools access the system clipboard visible to Chromium. Downloads write to the host filesystem. Both stay unavailable in read-only sessions.

A page handles one TideSurf download operation at a time. TideSurf waits for filename metadata before reporting a completed file and runs cleanup through one path.

## Chromium sandbox

TideSurf keeps the Chromium sandbox enabled under normal user accounts. Running as root may require Chromium's no-sandbox flags. `TIDESURF_NO_SANDBOX=1` also disables sandbox isolation and prints a security warning. Avoid both modes for untrusted pages.
