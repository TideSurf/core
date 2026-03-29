# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability in TideSurf, please report it responsibly.

**Email:** Open a [GitHub Security Advisory](https://github.com/TideSurf/core/security/advisories/new) (preferred) or email the maintainer directly.

**Do not** open a public issue for security vulnerabilities.

## Scope

TideSurf runs Chrome via CDP. Security-relevant areas include:

- **Input validation** — URLs, CSS selectors, JavaScript expressions, and file paths are validated before use.
- **Filesystem access** — Upload and download operations are confined to allowed roots (`cwd` + `tmpdir` by default).
- **Read-only mode** — `readOnly: true` disables all write tools.
- **Injected JS** — TideSurf injects JavaScript into pages for DOM marking. This code is static (no user input interpolation).

See the [security documentation](https://tidesurf.org/docs#security) for details.

## Supported versions

| Version | Supported |
|---|---|
| 0.5.x | Yes |
| < 0.5 | No |
