# API reference

## TideSurf lifecycle

### `TideSurf.launch(options?)`

```typescript
static launch(options?: TideSurfOptions): Promise<TideSurf>
```

Starts Chromium, connects through CDP, and returns a ready instance. TideSurf owns the process and cleans it up in `close()`. The default temporary profile is isolated; `userDataDir` selects another profile. Launch never attaches to an existing browser.

| Option | Type | Default | Description |
|---|---|---|---|
| `headless` | `boolean` | `true` | Use headless Chromium |
| `chromePath` | `string` | auto-detect | Explicit executable path |
| `channel` | `ChromeChannel` | first found | Select stable, Beta, Dev, Canary, or Chromium |
| `port` | `number` | ephemeral | Fixed CDP port; explicit collisions fail |
| `userDataDir` | `string` | temporary | Browser profile directory |
| `defaultViewport` | `{ width; height }` | browser default | Apply a viewport to connected tabs |
| `timeout` | `number` | operation default | Override startup and CDP timeouts in milliseconds |
| `readOnly` | `boolean` | `false` | Reject navigation, interaction, evaluation, clipboard, upload/download, and tab creation/closure |
| `fileAccessRoots` | `string[]` | working directory and OS temp | Allowed upload/download roots; `[]` disables file access |
| `allowLocalhost` | `boolean` | `false` | Permit loopback URLs |
| `allowPrivateHosts` | `boolean` | `false` | Permit private and link-local URLs, including loopback |

Executable resolution checks `chromePath`, `CHROME_PATH`, `PATH`, then platform install locations. The default channel order is stable, Beta, Dev, Canary, Chromium.

### `TideSurf.connect(options?)`

```typescript
static connect(options?: TideSurfConnectOptions): Promise<TideSurf>
```

Attaches to an existing CDP endpoint. Connect never launches a browser. `close()` disconnects without stopping the external process.

| Option | Type | Default | Description |
|---|---|---|---|
| `host` | `string` | `"localhost"` | CDP host |
| `port` | `number` | `9222` | CDP port |
| `defaultViewport` | `{ width; height }` | browser default | Apply a viewport to connected tabs |
| `timeout` | `number` | operation default | Override connection and CDP timeouts in milliseconds |
| `readOnly` | `boolean` | `false` | Enforce the read-only policy |
| `fileAccessRoots` | `string[]` | working directory and OS temp | Allowed upload/download roots; `[]` disables file access |
| `allowLocalhost` | `boolean` | `false` | Permit loopback URLs |
| `allowPrivateHosts` | `boolean` | `false` | Permit private and link-local URLs |

### `close()`

```typescript
close(): Promise<void>
```

Closes CDP sessions and, for launched instances, waits for the owned browser to exit before removing its temporary profile. Concurrent and repeated calls share one shutdown operation.

## Browser state

### `navigate(url)`

```typescript
navigate(url: string): Promise<void>
```

Navigates the active tab and waits for load. URL policy applies before navigation. Read-only instances throw `ReadOnlyError`.

### `getState(options?)`

```typescript
getState(options?: GetStateOptions): Promise<PageState>
```

Returns compact text and the matching in-memory ID map.

| Option | Type | Default | Description |
|---|---|---|---|
| `maxTokens` | `number` | unlimited | Prune lower-value content to a token estimate |
| `viewport` | `boolean` | `true` | Limit normal output to the current viewport |
| `mode` | `"full" \| "minimal" \| "interactive"` | `"full"` | Select detail level |
| `includeHidden` | `boolean` | `false` | Include hidden nodes and disable viewport filtering |

`includeHidden: true` is a full-DOM debugging override. It wins over `viewport: true`.

### `getPage()`

```typescript
getPage(): SurfingPage
```

Returns the active page API. The returned page inherits URL, filesystem, and read-only policy. It cannot bypass `readOnly`.

### `getToolExecutor()`

```typescript
getToolExecutor(): (
  call: { name: string; input: Record<string, unknown> }
) => Promise<ToolResult>
```

Returns the executor generated from the canonical tool registry.

### `getToolDefinitions()`

```typescript
getToolDefinitions(): ToolDefinition[]
```

Returns definitions allowed by this instance. Read-only instances return only the six observation tools. The package-level `getToolDefinitions({ readOnly? })` returns definitions without creating a browser.

### `isReadOnly()`

```typescript
isReadOnly(): boolean
```

Reports the immutable instance policy.

## Tab management

```typescript
listTabs(): Promise<TabInfo[]>
newTab(url?: string): Promise<TabInfo>
switchTab(tabId: string): Promise<void>
closeTab(tabId: string): Promise<void>
```

Each tab keeps its own page connection and ID map. `newTab()` activates the created tab. `switchTab()` remains available in read-only mode. `newTab()` and `closeTab()` throw `ReadOnlyError` there.

## SurfingPage

Every mutating method enforces read-only policy before CDP execution.

### `getState(options?)`

```typescript
getState(options?: GetStateOptions): Promise<PageState>
```

Reads this page with the same viewport, mode, hidden-node, and token-target options as `TideSurf.getState()`.

### `click(id)`

```typescript
click(id: string): Promise<void>
```

Resolves one current TideSurf ID and clicks it. A stale or missing ID throws `ElementNotFoundError`. Other CDP failures keep their original error type.

### `type(id, text, clear?)`

```typescript
type(id: string, text: string, clear?: boolean): Promise<void>
```

Types into a text input, textarea, or contenteditable textbox with a current TideSurf ID. `clear: true` replaces the current value.

### `select(id, value)`

```typescript
select(id: string, value: string): Promise<void>
```

Selects an option by value on a native `<select>`. ARIA listboxes can appear in page state but are not action targets for this method.

### `scroll(direction, amount?)`

```typescript
scroll(direction: "up" | "down", amount?: number): Promise<void>
```

Scrolls by pixels. The default amount is `500`.

### `waitForStable(timeout?)`

```typescript
waitForStable(timeout?: number): Promise<void>
```

Waits for this page to reach its DOM-mutation quiet window or hard deadline. Concurrent calls use independent observers.

### `extract(selector)`

```typescript
extract(selector: string): Promise<string>
```

Returns text from the first element matching a CSS selector. This observation method remains available in read-only mode.

### `navigate(url)`

```typescript
navigate(url: string): Promise<void>
```

Navigates this page under the instance URL policy.

### `evaluate(expression)`

```typescript
evaluate(expression: string): Promise<unknown>
```

Runs arbitrary JavaScript in the page context. TideSurf validates the input type and size. It does not sandbox JavaScript or restrict page capabilities. CDP `unserializableValue` results such as `NaN`, infinity, negative zero, and bigint are returned as JSON-safe strings. Read-only mode rejects this method.

### `search(query, maxResults?)`

```typescript
search(query: string, maxResults?: number): Promise<SearchResult[]>
```

Finds case-insensitive page text and returns snippets with a nearby current interactive ID when one exists.

### `screenshot(options?)`

```typescript
screenshot(options?: ScreenshotOptions): Promise<string>
```

Returns base64 PNG. `elementId` captures one element; `fullPage` captures the scrollable page; the default captures the viewport.

### `upload(id, filePaths)`

```typescript
upload(id: string, filePaths: string[]): Promise<void>
```

Sets files on a file input. Every path must resolve inside `fileAccessRoots`.

Omitting `fileAccessRoots` allows the working directory and OS temporary directory. Passing `fileAccessRoots: []` disables SDK uploads and downloads.

### Clipboard

```typescript
clipboardRead(): Promise<string>
clipboardWrite(text: string): Promise<void>
```

Reads or writes clipboard text. Both operations are unavailable in read-only mode.

### `download(id, options?)`

```typescript
download(
  id: string,
  options?: { downloadDir?: string; timeout?: number }
): Promise<DownloadResult>
```

Clicks one current element and waits for its file. The destination must resolve inside `fileAccessRoots`. A page accepts one active download operation at a time.

### `close()`

```typescript
close(): Promise<void>
```

Disconnects this page CDP client. Normal callers should close the owning `TideSurf` instance instead.

## Public types

### `ChromeChannel`

```typescript
type ChromeChannel = "stable" | "beta" | "dev" | "canary" | "chromium";
```

### `PageState`

```typescript
interface PageState {
  url: string;
  title: string;
  content: string;
  /** @deprecated Use content. */
  xml: string;
  nodeMap: Map<string, number>;
}
```

### `TabInfo`

```typescript
interface TabInfo {
  id: string;
  url: string;
  title: string;
  type: string;
}
```

### `SearchResult`

```typescript
interface SearchResult {
  text: string;
  tag: string;
  index: number;
  elementId?: string;
}
```

### `DownloadResult`

```typescript
interface DownloadResult {
  filePath: string;
  fileName: string;
  totalBytes: number;
}
```

### `ToolResult`

```typescript
interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  errorType?: string;
  stack?: string;
}
```

## Canonical tools

One registry supplies SDK definitions, executor dispatch, CLI parsing/help, MCP registration, read-only gating, and unknown-tool messages.

| Tool | Input | CLI | Read-only |
|---|---|---|---|
| `get_state` | `maxTokens?`, `viewport?`, `mode?`, `includeHidden?` | `get-state` | yes |
| `navigate` | `url` | `navigate` | no |
| `click` | `id` | `click` | no |
| `type` | `id`, `text`, `clear?` | `type` | no |
| `select` | `id`, `value` | `select` | no |
| `scroll` | `direction`, `amount?` | `scroll` | no |
| `extract` | `selector` | `extract` | yes |
| `evaluate` | `expression` | `evaluate` | no |
| `list_tabs` | none | `list-tabs` | yes |
| `new_tab` | `url?` | `new-tab` | no |
| `switch_tab` | `tabId` | `switch-tab` | yes |
| `close_tab` | `tabId` | `close-tab` | no |
| `search` | `query`, `maxResults?` | `search` | yes |
| `screenshot` | `elementId?`, `fullPage?` | `screenshot` | yes |
| `upload` | `id`, `filePath` | `upload` | no |
| `clipboard_read` | none | `clipboard-read` | no |
| `clipboard_write` | `text` | `clipboard-write` | no |
| `download` | `id`, `downloadDir?`, `timeout?` | `download` | no |

CLI underscore aliases match tool names. MCP also registers `launch_browser` as a compatibility lifecycle tool; it is not one of the 18 registry tools.

The executor returns page text for state actions, raw objects or arrays for structured tools, and a base64 PNG for `screenshot`. The CLI and MCP adapters format those values for their transports.

## Public helpers

The package also exports:

- `discoverBrowser(options?)` for strict discovery of an existing CDP page target
- `validateUrl`, `validateSelector`, `validateExpression`, `validateElementId`, `validatePort`, and `validateFilePath`
- `withTimeout` for bounded operations and `withRetry` as an exported retry utility
- `estimateTokens(text, charsPerToken?)` and `pruneToFit(nodes, options)` for parser integrations
- `TabManager` for low-level CDP tab management

These are library helpers, not CLI or MCP tools. `discoverBrowser()` does not launch Chromium.
