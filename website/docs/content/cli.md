# CLI

The TideSurf CLI gives shell agents direct browser tools without an MCP client. One background process owns each named session, so state survives across commands.

## Core loop

```bash
tidesurf navigate https://example.com
tidesurf get-state
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
| `tidesurf start` | Start the selected session and browser |
| `tidesurf status` | Report state without starting a session |
| `tidesurf stop` | Stop the session; repeated calls succeed |
| `tidesurf tools` | List the 18 tools from the canonical registry |
| `tidesurf call <tool> --input <json\|->` | Call a tool by MCP name; `-` reads stdin |
| `tidesurf help [command]` | Show global or generated command help |
| `tidesurf inspect <url>` | Run the retained one-shot inspection flow |
| `tidesurf mcp` | Serve the MCP adapter over stdio |

No arguments and `--help` show global help. `--version` prints the package version. Direct commands also accept `--help`.

## Direct tool commands

Hyphenated commands are the primary CLI spelling. Underscore aliases match MCP names.

| Command | Main arguments and options |
|---|---|
| `get-state` / `get_state` | `--max-tokens N`, `--viewport true\|false`, `--full-page`, `--mode full\|minimal\|interactive`, `--include-hidden` |
| `navigate <url>` | Open a URL and return page state |
| `click <id>` | Click an ID and return page state |
| `type <id> <text>` | `--clear` replaces existing input |
| `select <id> <value>` | Select an option value |
| `scroll <up\|down>` | `--amount N` sets pixels |
| `extract <selector>` | Extract matching text |
| `evaluate <expression>` | Run arbitrary page JavaScript |
| `list-tabs` / `list_tabs` | List tab IDs, URLs, and titles |
| `new-tab [url]` / `new_tab` | Open and activate a tab |
| `switch-tab <tab-id>` / `switch_tab` | Activate a tab and return its state |
| `close-tab <tab-id>` / `close_tab` | Close a tab and list remaining tabs |
| `search <query>` | `--max-results N` limits matches |
| `screenshot` | `--element-id ID`, `--full-page`, `--output FILE\|-` |
| `upload <id> <file>` | Set a local file on a file input |
| `clipboard-read` / `clipboard_read` | Read clipboard text |
| `clipboard-write <text>` / `clipboard_write` | Write clipboard text |
| `download <id>` | `--download-dir DIR`, `--timeout MS` |

Shell quoting still applies. Quote selectors, JavaScript, search text, and typed text that contain spaces or shell characters.

## Raw tool calls

`call` accepts the same JSON object used by the SDK executor and MCP:

```bash
tidesurf call get_state --input '{"mode":"interactive","maxTokens":500}'
printf '%s' '{"url":"https://example.com"}' | tidesurf call navigate --input -
```

The tool name may use its canonical underscore name or hyphenated CLI alias. Input must be one JSON object.

## Session startup policy

Startup flags apply when the session daemon starts. The policy remains fixed until `stop`. Later commands can omit the flags or repeat matching standalone values without restating unrelated flags. Browser-selection combinations must resolve to the stored mode, and repeating `--file-access-root` requires the complete stored root list. Supplying a conflicting value returns an error and leaves the current session unchanged.

| Option | Purpose |
|---|---|
| `--session NAME` | Select a session; default `default` |
| `--headful` | Show the managed browser window |
| `--auto-connect` | Attach when possible, otherwise launch locally |
| `--connect-only` | Attach and fail if no browser is available |
| `--browser-url URL` | Use an explicit `http://` CDP discovery origin |
| `--host HOST` | Select a CDP host |
| `--port PORT` | Select a fixed port; launch otherwise uses an ephemeral port and attach defaults to `9222` |
| `--chrome-path FILE` | Use a specific executable |
| `--channel NAME` | Select `stable`, `beta`, `dev`, `canary`, or `chromium` |
| `--user-data-dir DIR` | Use a specific browser profile directory |
| `--read-only` | Fix the session to observation operations |
| `--allow-localhost` | Permit loopback navigation |
| `--allow-private-hosts` | Permit private and link-local navigation, including loopback |
| `--file-access-root DIR` | Add an upload/download root; repeat as needed |
| `--timeout MS` | Set the operation and startup timeout |

Session names contain letters, numbers, dots, dashes, or underscores. Use different names when workflows need different browser or security policies.

`download` also has a tool-level `--timeout`. After the `download` command, it sets the file wait. Put the global flag before the command to set session timing: `tidesurf --timeout 60000 download B1 --timeout 30000`.

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

`--quiet` suppresses the MCP ready message.

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

## Shutdown ownership

`stop` closes only a Chromium process launched by the selected TideSurf session. An attached browser stays open; TideSurf only disconnects its CDP clients. Temporary managed profiles are removed after the owned process exits.

## MCP mode

`tidesurf mcp` registers the same 18 tools and schemas. MCP also keeps `launch_browser` for compatibility. Screenshots become MCP image blocks, and failures set `isError`.
