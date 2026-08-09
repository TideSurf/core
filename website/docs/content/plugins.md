# Plugins and skills

TideSurf speaks two open packaging standards on both sides of the connection:

- **Agent Plugins v1.0.0** ([agent-plugins.org](https://agent-plugins.org/specification)): a directory with a `plugin.json` manifest, optional `skills/`, and an optional `mcp.json` declaring MCP servers.
- **Agent Skills** ([agentskills.io](https://agentskills.io/specification)): a directory with a `SKILL.md` (YAML frontmatter plus a markdown document), optionally with `scripts/`, `references/`, and `assets/`.

As a **host**, TideSurf loads plugins and skills and exposes them to the agent. As a **plugin**, the npm package itself is a valid plugin directory that compatible clients (VS Code, Cursor, Copilot, Codex, Kiro) can install.

## Discovery roots

| Component | Project scope | User scope |
|---|---|---|
| Agent Plugins | `.tidesurf/plugins/` | `~/.tidesurf/plugins/` |
| Agent Skills | `.agents/skills/`, `.tidesurf/skills/` | `~/.agents/skills/`, `~/.tidesurf/skills/` |

Each immediate subdirectory of a plugins root with a `plugin.json` is one plugin. Each immediate subdirectory of a skills root with a `SKILL.md` is one skill. A plugin's own `skills/` directory contributes its skills too.

Environment overrides:

- `TIDESURF_PLUGINS_DIR` and `TIDESURF_SKILLS_DIR` replace the default root lists (multiple paths separated by the OS path delimiter).
- `TIDESURF_EXTENSIONS=user` skips project-scoped roots; `TIDESURF_EXTENSIONS=off` disables extension loading entirely. The default, `all`, loads both scopes. Project scope wins on name collisions; later duplicates are reported as diagnostics and skipped.

Discovery re-runs on every call, so installing a skill takes effect without restarting the session.

## Loading model

Loading follows the Agent Skills progressive-disclosure pattern:

1. `list_skills` returns the catalog: name, description, and source for every installed skill. This is the cheap, always-available tier, and the MCP adapter also publishes it in server instructions.
2. `read_skill` with a `name` returns one skill's full document and bundled file list.
3. Bundled files (`scripts/`, `references/`, `assets/`) stay on disk; the agent reads them at the paths listed by `read_skill` only when the document asks for them.

Both tools are read-only and work without a browser.

Validation follows the specs with failure isolation: a broken skill is skipped with a diagnostic, a broken `mcp.json` disables only that plugin's MCP servers, and a broken plugin never blocks its siblings. Diagnostics surface in `list_skills` output, `tidesurf skills`/`tidesurf plugins`, and MCP stderr logs.

## CLI

```sh
tidesurf skills            # catalog: name, source, description
tidesurf skills <name>     # full document + bundled file list
tidesurf plugins           # plugins with skills, MCP servers, diagnostics
tidesurf skills --json     # machine-readable output
tidesurf read_skill <name> # same document through the session transport
```

## MCP integration

`tidesurf mcp` publishes the skill catalog in its server instructions, so an MCP client knows what is installed before calling any tool. When an installed plugin declares MCP servers in `mcp.json`, the adapter connects to each one and re-registers its tools as `<plugin>__<tool>`:

- `stdio` servers are spawned with `PLUGIN_ROOT` and `PLUGIN_DATA` environment variables. `PLUGIN_DATA` points at `~/.tidesurf/plugin-data/<plugin>`, a persistent writable directory TideSurf creates per plugin.
- `streamable-http` servers are connected remotely. Legacy `sse` entries are skipped with a diagnostic, per the spec's deprecation.
- Placeholders `${PLUGIN_ROOT}` and `${PLUGIN_DATA}` in `args`, `env` values, and `cwd` are expanded once, and every plugin-supplied path must stay inside the plugin directory.
- A server that fails to start or a tool that fails to convert is skipped with a stderr diagnostic; TideSurf's own tools are never affected.

## Install TideSurf as your agent tool

The `@tidesurf/core` package root contains `plugin.json`, `mcp.json`, and `skills/tidesurf-browser/`, so any Agent Plugins compatible client can register it directly:

```sh
# Agent Skills CLI (any skills-compatible agent)
npx skills add TideSurf/core

# or copy the skill into your project
mkdir -p .agents/skills
cp -r node_modules/@tidesurf/core/skills/tidesurf-browser .agents/skills/
```

For MCP-only clients, the config is one server entry:

```json
{
  "mcpServers": {
    "tidesurf": {
      "command": "tidesurf",
      "args": ["mcp"]
    }
  }
}
```

The bundled skill teaches the agent the TideSurf workflow: read state, act on current element IDs, re-read after the page changes, and keep output inside a token budget.

## Writing extensions for TideSurf

A minimal plugin:

```text
my-plugin/
  plugin.json
  skills/
    my-skill/
      SKILL.md
  mcp.json            # optional
```

`plugin.json` requires `$schema` (`https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`) and a `name` (1-64 chars, lowercase `a-z0-9-.`, no `--` or `..` runs). Unknown top-level fields are reported and ignored; wrong types on known fields reject the plugin.

`SKILL.md` requires a `name` matching its directory and a `description` of up to 1,024 characters; `license`, `compatibility`, `metadata`, and `allowed-tools` are optional. Keep the document under 500 lines.

## Security model

The Agent Plugins v1.0.0 spec defines no signing, permissions, or sandboxing, and TideSurf adds none: plugin MCP servers run with your user privileges, like any MCP server you configure yourself. Treat project-scoped plugins and skills as untrusted repository content: review them, or run with `TIDESURF_EXTENSIONS=user` to load only your own extensions. TideSurf enforces the spec's path-containment rules (plugin paths may not escape the plugin directory) and never writes outside `PLUGIN_DATA` on a plugin's behalf.
