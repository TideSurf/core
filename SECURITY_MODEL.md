# TideSurf Security Model

## Basis and scope

Scope: the whole `TideSurf/core` repository, including SDK, CLI, MCP, extensions, websites and delivery workflows. There is no separate infrastructure repository. Deployment evidence is the in-repository GitHub Pages and npm workflows; downstream deployments and network controls are unknown.

This model incorporates the maintainer-authored [security policy](SECURITY.md), [detailed security model](website/docs/content/security.md), and [agent guide](AGENTS.md). Code-derived descriptions below are observations, not acceptance of risk.

## System and components

TideSurf is a local TypeScript browser-automation library and stateful CLI. An agent calls tools through the SDK, CLI or MCP stdio adapter. The process launches isolated Chromium or attaches to a supplied CDP endpoint. It reads DOM snapshots, renders compact text and can perform page, clipboard and filesystem operations. Optional plugins add executable or remote MCP servers.

Use these stable component names for findings:

| Component | Code covered | Boundary and responsibility |
| --- | --- | --- |
| Agent Gateway | `src/tools/`, `src/mcp/adapter.ts`, `src/cli-program.ts`, `src/types.ts`, `src/index.ts` | Agent/SDK/MCP requests enter the shared registry and executor; requests are not equivalent to trusted page content. |
| Local Sessions | `src/cli/`, `src/cli.ts` | CLI clients cross authenticated local IPC into a persistent daemon and immutable session policy. |
| Browser Runtime | `src/tidesurf.ts`, `src/cdp/launcher.ts`, `connection.ts`, `tab-manager.ts`, `retry.ts`, `timeout.ts`, `viewport.ts` under `src/cdp/` | Host process crosses CDP into an owned or external Chromium process/profile. |
| Page IO | `src/cdp/page.ts`, `src/cdp/download-manager.ts`, `src/validation.ts`, `src/errors.ts` | Page actions, URL policy, clipboard and file transfers cross browser/network/host boundaries. |
| DOM Readout | `src/parser/`, `src/cdp/snapshot.ts` | Attacker-controlled DOM and snapshot data become agent-visible structured text and interaction handles. |
| Extensions | `src/extensions/`, `src/mcp/plugin-proxy.ts`, `plugin.json`, `mcp.json`, `skills/` | Repository/user files select skills and local commands or remote MCP servers, crossing host execution and remote-service trust boundaries. |
| Delivery | `website/`, `.github/workflows/`, `scripts/`, `package.json`, lockfiles and packaging metadata | Source/dependencies become npm artifacts and a public GitHub Pages site through CI/release identities. |

## Entry points and reachability

- **Agent callers:** SDK methods, CLI arguments and shared tool calls; MCP runs over stdio, not a documented public HTTP application endpoint. Whether callers/models are trusted is a deployment decision.
- **Local clients:** Unix domain socket or Windows named pipe, metadata, logs, startup state and random authentication secret. Other OS users matter; the documented transport is not intended to resist an already-compromised same-OS-account process.
- **Web content:** arbitrary visited pages, DOM text/attributes, frame content, navigation responses and downloaded files. Content can influence an agent; page material must not silently become host authority.
- **CDP:** managed launch uses a local ephemeral port and temporary profile. Explicit connect/auto-connect/custom profiles can grant existing authenticated browser authority. Remote CDP exposure and endpoint identity are operator responsibilities.
- **Extensions:** user-scoped extensions load by default; project extensions require `TIDESURF_EXTENSIONS=all`. Plugin manifests, skill text, declared commands, remote URLs, schemas and tool results are separate input surfaces.
- **Delivery:** pull requests, dependency installation, release tags, package publication and public website content. GitHub Pages deployment and npm publication run in separate workflows.

## Assets and sensitivity

- Browser cookies, storage, logged-in sessions, page content/screenshots and actions performed under that identity.
- Host files in configured roots, system clipboard, session authentication material and plugin data.
- Host execution authority, parent environment credentials, plugin-declared credentials and remote MCP headers.
- Availability and policy integrity of long-running CLI/browser sessions, and integrity of agent-visible observations/interaction handles.
- npm release artifacts, CI identities/publication credentials and public documentation/site integrity.

The maintainer prioritizes malicious pages and prompt-influenced agents reaching browser identity or host files. Other assets remain in scope; not every deployment necessarily contains production secrets.

## Relevant attackers

Primary attackers: malicious website/content authors and prompt-influenced agent/tool callers. Other relevant working assumptions, not excluded: malicious repository extension author; malicious/compromised plugin MCP service; different-account local user; dependency/CI contributor or compromised delivery dependency. An attacker already executing as the same OS user, a deliberately trusted installed plugin, or a deliberately attached personal browser has the limits described below. No additional attacker class is excluded.

## Documented controls and limits

- Read-only policy is enforced by registry/executor, MCP, TideSurf and direct SurfingPage APIs. Observation includes state/extract/tabs/search/screenshots and skills; navigation, interactions, evaluate, clipboard, filesystem and tab mutation are denied. CLI session policy cannot be weakened by later invocations.
- `evaluate` is intentionally arbitrary JavaScript with page DevTools authority, not a sandbox. Expression validation does not promise confinement.
- Upload/download paths are constrained by `fileAccessRoots`; defaults are the working directory and OS temporary directory. An empty SDK list disables file access.
- URL validation rejects literal local/private/link-local destinations and special-use localhost by default. It does not resolve public DNS, protect every redirect, stop rebinding or constrain page/evaluate networking. External outbound controls are required for a network sandbox.
- Managed browser launch isolates profile and binds locally. Explicit CDP attachment has no TideSurf authorization or browser identity guarantee. Closing an attached instance leaves the external browser running.
- Local runtime directory ownership/mode checks and per-request random secrets protect IPC. The stated boundary excludes an attacker who already has the same account's file permissions.
- State capture uses a bounded non-mutating preflight and DOMSnapshot; default filtering omits hidden/offscreen content. `includeHidden` deliberately expands visibility and is not a confidentiality boundary.
- Extensions default to user scope; `user` or `off` excludes project extensions. Plugins are user-privileged code, not sandboxes. Children use a minimal allowlisted environment plus declared entries; plugin path/data containment, scope isolation, no HTTP redirects, bounded proxy resources and recursion prevention are documented. Plugin servers do not start in read-only mode.
- Chromium's sandbox is normally enabled; root execution or explicit `TIDESURF_NO_SANDBOX=1` disables it with a warning.
- Delivery workflows pin referenced actions to commits, disable persisted checkout credentials, use frozen installs, and scope Pages write/OIDC permissions to deployment. npm publication requests provenance and uses the configured registry credential.

## Accepted limits and reranking policy

The maintainer's security documentation expressly disclaims JavaScript sandboxing for enabled evaluate, a complete outbound network sandbox, defense from same-account host compromise through local IPC, sandboxing of deliberately trusted plugins, and reduced authority when attaching a personal profile. These are documented capability boundaries, not blanket waivers for vulnerabilities in their enforcement.

Do not dismiss a finding merely because it involves plugins, CDP, files or private networks. A bypass of read-only policy, project-extension consent, file roots, environment/data isolation or other promised containment remains relevant. Distinguish expected explicitly enabled authority from an unintended path to it.

Start from the scanner's verified severity and exploit preconditions. Consider a higher priority only where the scanner confirms a feasible path from a primary attacker to browser identity or host files; never raise hard-to-exploit or unverified findings. This focus does not exclude or accept other risks. Code-derived assumptions alone do not change priority. Move priority only for maintainer-authored security-model facts or explicit maintainer corrections or acceptance. Record likelihood, impact and component for every open finding.

## Open questions

- Are there additional explicit exclusions or accepted risks beyond the published capability boundaries? None have been specified.
- Should the security policy's supported-version table be updated? It lists 0.6.x while the package declares 0.7.2.

Update this model when components, trust boundaries or accepted risks change. Use it as the starting point for future scan threat models and findings triage.
