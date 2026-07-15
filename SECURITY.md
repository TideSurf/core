# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability in TideSurf, please report it responsibly.

**Email:** Open a [GitHub Security Advisory](https://github.com/TideSurf/core/security/advisories/new) (preferred) or email the maintainer directly.

**Do not** open a public issue for security vulnerabilities.

## Scope

TideSurf controls Chromium through CDP. An attached session can read and change everything available to that browser profile.

- **Read-only mode**: `readOnly: true` keeps only `get_state`, `extract`, `list_tabs`, `switch_tab`, `search`, and `screenshot`. The registry, executor, `TideSurf`, and direct `SurfingPage` methods enforce the policy.
- **Arbitrary JavaScript**: `evaluate` validates expression shape and size but is not a sandbox. It runs with page DevTools authority. Use read-only mode to remove it.
- **Filesystem access**: uploads and downloads stay inside `fileAccessRoots`. The default allows the working directory and OS temporary directory. `fileAccessRoots: []` disables SDK file access.
- **Navigation input**: local, private, and link-local destinations are blocked by default. These checks do not replace an outbound network sandbox or stop DNS rebinding.
- **Browser profiles**: managed CLI sessions use an isolated temporary profile and local ephemeral debugging port by default. Attaching to a personal profile grants its authority to the session.
- **Page reads**: state capture uses a bounded, non-mutating node preflight and `DOMSnapshot.captureSnapshot`. It does not add marker attributes to the page.

See the [security documentation](https://tidesurf.org/docs#security) for details.

## Supported versions

| Version | Supported |
|---|---|
| 0.6.x | Yes |
| < 0.6 | No |
