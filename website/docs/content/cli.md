# CLI

The TideSurf CLI gives shell agents direct browser tools without an MCP client. One background process owns each named session, so state survives across commands.

## Core loop

```bash
tidesurf navigate https://example.com
tidesurf get_state
tidesurf click B1
tidesurf stop
```

The first tool command starts the `default` session and its browser. Use `--session <name>` for another workflow:

```bash
tidesurf --session docs navigate https://example.com/docs
tidesurf --session docs search "installation"
```

Every tool call in a session runs serially. The daemon preserves the exact element ID maps, open tabs, and active tab. It has no idle shutdown.

## Lifecycle and discovery commands

| Command | Behavior |
|---|---|
| `tidesurf start [startup options]` | Start the session and browser |
| `tidesurf status [--session <name>] [--json]` | Show session and browser state |
| `tidesurf stop [--session <name>] [--json]` | Stop the session |
| `tidesurf tools [--json]` | List browser tools |
| `tidesurf call <tool> --input <json\|-> [global options]` | Call a tool with JSON input |
| `tidesurf inspect <url>` | Print a one-shot compressed page |
| `tidesurf mcp [startup options]` | Run the MCP stdio adapter |
| `tidesurf help [command]` | Show command help |

No arguments and `--help` show global help. `--version` prints the package version. Direct commands also accept `--help`.

## Direct tool commands

Direct commands use the exact registry and MCP tool identifiers.

| Command | Main arguments and options |
|---|---|
| `get_state` | `--max-tokens N`, `--viewport true\|false`, `--full-page`, `--mode full\|minimal\|interactive`, `--include-hidden` |
| `navigate <url>` | Open a URL and return page state |
| `click <id>` | Click an ID and return page state |
| `type <id> <text>` | `--clear` replaces existing input |
| `select <id> <value>` | Select an option value |
| `scroll <up\|down>` | `--amount N` sets pixels |
| `extract <selector>` | Extract matching text |
| `evaluate <expression>` | Run arbitrary page JavaScript |
| `list_tabs` | List tab IDs, URLs, and titles |
| `new_tab [url]` | Open and activate a tab |
| `switch_tab <tab-id>` | Activate a tab and return its state |
| `close_tab <tab-id>` | Close a tab and list remaining tabs |
| `search <query>` | `--max-results N` limits matches |
| `screenshot` | `--element-id ID`, `--full-page`, `--output FILE\|-` |
| `upload <id> <file>` | Set a local file on a file input |
| `clipboard_read` | Read clipboard text |
| `clipboard_write <text>` | Write clipboard text |
| `download <id>` | `--download-dir DIR`, `--timeout MS` |

Shell quoting still applies. Quote selectors, JavaScript, search text, and typed text that contain spaces or shell characters.

## Raw tool calls

`call` accepts the same JSON object used by the SDK executor and MCP:

```bash
tidesurf call get_state --input '{"mode":"interactive","maxTokens":500}'
printf '%s' '{"url":"https://example.com"}' | tidesurf call navigate --input -
```

Input must be one JSON object.

## Global options

Global flags may appear before or after the command. Startup flags set daemon policy on the first call. That policy remains fixed until `stop`. Later commands may omit startup flags or repeat matching values. Browser-selection combinations must resolve to the stored mode, and a repeated `--file-access-root` list must match the complete stored list.

| Option | Purpose |
|---|---|
| `--session NAME` | Select a named session (default: default) |
| `--json` | Emit the ToolResult JSON shape |
| `--quiet` | Suppress the MCP ready message |
| `--headful` | Show the managed browser window |
| `--auto-connect` | Try attach discovery, then launch locally |
| `--connect-only` | Attach without launching a browser |
| `--browser-url URL` | Use an explicit browser HTTP endpoint |
| `--host HOST` | Use an explicit CDP host |
| `--port PORT` | Use a fixed CDP port (launch or attach by mode) |
| `--chrome-path FILE` | Use a Chrome or Chromium executable |
| `--channel NAME` | Select stable, beta, dev, canary, or chromium |
| `--user-data-dir DIRECTORY` | Use a browser profile directory |
| `--read-only` | Disable mutating and sensitive browser tools |
| `--allow-localhost` | Permit loopback navigation |
| `--allow-private-hosts` | Permit private, link-local, and loopback navigation |
| `--file-access-root PATH` | Add an upload/download root; repeatable |
| `--timeout MS` | Set browser startup and operation timeout |

Session names contain letters, numbers, dots, dashes, or underscores. Use different names when workflows need different browser or security policies.

`download` also has a tool-level `--timeout`. After the `download` command, it sets the file wait. Put the global flag before the command to set session timing: `tidesurf --timeout 60000 download B1 --timeout 30000`.

Timeouts use positive whole milliseconds and cannot exceed 2,147,483,647 ms. The CLI also rejects a computed request budget above its 1,073,741,823 ms transport limit before sending the operation.

Without `--auto-connect`, `--browser-url` or `--host` selects strict attach behavior. A bare `--port` fixes the managed launch port; combine it with `--connect-only` or `--auto-connect` to use it for attachment.

## Browser selection

Managed isolated launch is the default. TideSurf searches in this order:

1. `--chrome-path`
2. `CHROME_PATH`
3. supported executable names on `PATH`
4. platform install locations, including macOS user applications and Windows `LOCALAPPDATA`

Without `--channel`, channel priority is stable, Beta, Dev, Canary, Chromium. Executables must be regular files and executable where the platform requires it. Edge and Brave need `--chrome-path`. TideSurf never downloads a browser.

Managed launch uses a temporary profile unless `--user-data-dir` is set. It requests port `0`, reads the actual endpoint from `DevToolsActivePort`, and rejects collisions when a fixed `--port` is supplied.

`--auto-connect` checks an explicit endpoint first, then a supported Chrome profile `DevToolsActivePort`, then the conventional local CDP endpoint. It launches a local browser only after local attach attempts fail. A remote-host failure never triggers local launch.

`--connect-only` follows the attach checks but never launches. Chrome 144 profile attachment may require approval at `chrome://inspect#remote-debugging`; see [Chrome agent configuration](https://developer.chrome.com/docs/devtools/agents/get-started/configuration). Manual Chrome 136+ remote debugging needs a non-default `--user-data-dir`; see [the remote debugging change](https://developer.chrome.com/blog/remote-debugging-port).

## Output

Strings and page state print as text. Objects and arrays print as formatted JSON. `--json` wraps every tool response in the existing `ToolResult` shape:

```json
{
  "success": true,
  "data": "result"
}
```

Errors go to stderr. Exit codes are stable:

| Code | Meaning |
|---|---|
| `0` | Success |
| `2` | CLI usage or input parsing error |
| `3` | Session or browser startup/connection error |
| `4` | Tool execution failed |
| `5` | Daemon authentication, transport, or protocol error |

## Screenshots

The default screenshot command writes a unique PNG under the OS temporary directory and prints its absolute path:

```bash
tidesurf screenshot
```

Select a path or stream bytes:

```bash
tidesurf screenshot --full-page --output ./page.png
tidesurf screenshot --output - > page.png
```

`--output -` cannot be combined with `--json`.

Element and full-page captures cannot exceed 16,384 px on either side or 12,000,000 total pixels. SDK `defaultViewport` values use the same limit.

## Shutdown ownership

`stop` closes only a Chromium process launched by the selected TideSurf session. An attached browser stays open; TideSurf only disconnects its CDP clients. Temporary managed profiles are removed after the owned process exits.

## MCP mode

`tidesurf mcp` registers the same 18 tools and schemas plus the `launch_browser` lifecycle tool. Screenshots become MCP image blocks, and failures set `isError`.
