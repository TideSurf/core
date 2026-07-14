# API reference

## TideSurf

Manages browser lifecycle, tabs, state, and page operations.

### `TideSurf.launch(options?)`

```typescript
static launch(options?: TideSurfOptions): Promise<TideSurf>
```

Launches Chrome, connects through CDP, and returns a ready `TideSurf` instance. Connection failures retry up to 3 times.

**Options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `headless` | `boolean` | `true` | Run Chrome in headless mode |
| `chromePath` | `string` | auto-detect | Path to Chrome executable |
| `port` | `number` | `9222` | Chrome DevTools Protocol port |
| `userDataDir` | `string` | temp profile | Override the Chrome user data directory |
| `defaultViewport` | `{ width: number; height: number }` | browser default | Viewport size to apply to the connected tab |
| `timeout` | `number` | `10000` | CDP connection timeout in milliseconds |
| `readOnly` | `boolean` | `false` | Disable mutating and sensitive tools, including `evaluate` and `clipboard_read` |
| `fileAccessRoots` | `string[]` | `[cwd, tmpdir]` | Allowed host filesystem roots for `upload` and `download` |

### `TideSurf.connect(options?)`

```typescript
static connect(options?: TideSurfConnectOptions): Promise<TideSurf>
```

Connects to a running Chrome instance through CDP. TideSurf does not own that process; `close()` only disconnects.

Requires Chrome to have remote debugging enabled (Chrome 144+: `chrome://inspect#remote-debugging`, or launch with `--remote-debugging-port`).

**Options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `port` | `number` | `9222` | CDP port to connect to |
| `host` | `string` | `"localhost"` | CDP host to connect to |
| `timeout` | `number` | `10000` | Connection timeout in milliseconds |
| `defaultViewport` | `{ width: number; height: number }` | browser default | Viewport size to apply to the connected tab |
| `readOnly` | `boolean` | `false` | Disable mutating and sensitive tools, including `evaluate` and `clipboard_read` |
| `fileAccessRoots` | `string[]` | `[cwd, tmpdir]` | Allowed host filesystem roots for `upload` and `download` |

**Throws:** `CDPConnectionError` for a missing Chrome instance on the target port, with remote-debugging setup guidance.

### `navigate(url)`

```typescript
navigate(url: string): Promise<void>
```

Navigates the active tab and waits for load. An unreachable URL throws `NavigationError`; an invalid URL throws `ValidationError`.

### `getState(options?)`

```typescript
getState(options?: GetStateOptions): Promise<PageState>
```

Returns the compressed text representation of the active tab's DOM. The returned `PageState` object contains a `content` property with the compressed page content (`.xml` is a deprecated alias).

**Options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `maxTokens` | `number` | unlimited | Maximum token budget for the output |
| `viewport` | `boolean` | `true` | Only include elements visible in the current viewport |
| `mode` | `"full" \| "minimal" \| "interactive"` | `"full"` | Output filtering mode |
| `includeHidden` | `boolean` | `false` | Include elements hidden by CSS (opacity:0, visibility:hidden, display:none). Useful for debugging. |

Modes compose. `getState({ viewport: true, mode: "interactive", maxTokens: 200 })` keeps visible controls within 200 tokens.

Each internal `OSNode` carries runtime state such as `disabled`, `inert`, `obscured`, `checked`, `required`, `readonly`, and `aria-expanded`. Serialization turns these into `~~strikethrough~~`, `open`, `closed`, and other inline markers described in [Page format](#page-format).

## Types

### `PageState`

```typescript
interface PageState {
  url: string;           // Current page URL
  title: string;         // Page title
  content: string;       // Compressed DOM representation (primary field)
  xml: string;          // @deprecated Alias for content
  nodeMap: Map<string, number>;  // Maps TideSurf IDs to CDP backendNodeIds
}
```

### `GetStateOptions`

```typescript
interface GetStateOptions {
  maxTokens?: number;                    // Token budget for output
  viewport?: boolean;                     // Only include visible elements (default: true)
  mode?: "full" | "minimal" | "interactive";  // Output filtering mode
  includeHidden?: boolean;                // Include CSS-hidden elements
}
```

### `TabInfo`

```typescript
interface TabInfo {
  id: string;     // CDP target ID
  url: string;    // Tab URL
  title: string;  // Tab title
  type: string;   // Always "page" for regular tabs
}
```

### `ScrollPosition`

```typescript
interface ScrollPosition {
  scrollY: number;         // Current vertical scroll position
  scrollHeight: number;   // Total scrollable height
  viewportHeight: number; // Visible viewport height
}
```

### `SearchResult`

```typescript
interface SearchResult {
  text: string;       // Surrounding text context
  tag: string;        // HTML tag name
  index: number;      // Match index (1-based)
  elementId?: string; // Nearest interactive TideSurf ID
}
```

### `DownloadResult`

```typescript
interface DownloadResult {
  filePath: string;   // Absolute path to downloaded file
  fileName: string;   // Original file name
  totalBytes: number; // File size in bytes
}
```

## Tool response formats

The executor and MCP wrap tool responses; direct SDK methods return these values:

| Tool | Return Type | Description |
|------|-------------|-------------|
| `get_state` | `PageState` | Full page state with content, url, title, nodeMap |
| `navigate` | `void` | Throws on failure, use `get_state` after to see result |
| `click` | `void` | Throws on failure, page may navigate or update |
| `type` | `void` | Throws on failure |
| `select` | `void` | Throws on failure |
| `scroll` | `void` | Throws on failure |
| `extract` | `string` | Extracted text content |
| `evaluate` | `unknown` | JavaScript evaluation result (serialized to string in MCP) |
| `list_tabs` | `TabInfo[]` | Array of tab information |
| `new_tab` | `TabInfo` | Created tab information |
| `switch_tab` | `void` | Throws on failure |
| `close_tab` | `void` | Throws on failure |
| `search` | `SearchResult[]` | Array of search matches |
| `screenshot` | `string` | Base64-encoded PNG image |
| `upload` | `void` | Throws on failure |
| `clipboard_read` | `string` | Clipboard text content |
| `clipboard_write` | `void` | Throws on failure |
| `download` | `DownloadResult` | Download file information |

### `getPage()`

```typescript
getPage(): SurfingPage
```

Returns the active tab's `SurfingPage` for element-level actions.

### `getToolExecutor()`

```typescript
getToolExecutor(): (tool: { name: string; input: Record<string, unknown> }) => Promise<ToolResult>
```

Returns a named-tool executor for LLM agent loops.

### `getToolDefinitions()`

```typescript
getToolDefinitions(): ToolDefinition[]
```

Returns 18 function-calling schemas for the model's tool parameter.

### Tab management

```typescript
listTabs(): Promise<TabInfo[]>          // List all open tabs
newTab(url?: string): Promise<TabInfo>  // Open a new tab
switchTab(tabId: string): Promise<void> // Switch active tab
closeTab(tabId: string): Promise<void>  // Close a tab
close(): Promise<void>                  // Shut down browser
```

## SurfingPage

Provides page-level actions through `browser.getPage()`.

### `click(id)`

```typescript
click(id: string): Promise<void>
```

Clicks a TideSurf ID such as `"B1"` or `"L3"`. A missing current-DOM ID throws `ElementNotFoundError`.

### `type(id, text, clear?)`

```typescript
type(id: string, text: string, clear?: boolean): Promise<void>
```

Types into an input or textarea. `clear: true` replaces its value; the default appends.

### `select(id, value)`

```typescript
select(id: string, value: string): Promise<void>
```

Selects an option in a dropdown (`<select>`) element by its value attribute.

### `scroll(direction, amount?)`

```typescript
scroll(direction: "up" | "down", amount?: number): Promise<void>
```

Scrolls the page in the given direction. The `amount` parameter is measured in pixels (defaults to `500`).

### `extract(selector)`

```typescript
extract(selector: string): Promise<string>
```

Extracts text from elements matching a CSS selector, including content outside compressed state.

### `navigate(url)`

```typescript
navigate(url: string): Promise<void>
```

Navigates the current page to a new URL. Equivalent to calling `browser.navigate()` but scoped to this page instance.

### `evaluate(expression)`

```typescript
evaluate(expression: string): Promise<unknown>
```

Executes JavaScript in the page context and returns its result. This bypasses TideSurf's structured interaction model and needs DevTools-level caution. Read-only sessions omit `evaluate`.

### `search(query, maxResults?)`

```typescript
search(query: string, maxResults?: number): Promise<SearchResult[]>
```

Finds text case-insensitively. Returns up to `maxResults` matches (default 10), surrounding context, and an available nearest interactive ID.

### `screenshot(options?)`

```typescript
screenshot(options?: ScreenshotOptions): Promise<string>
```

Captures a PNG screenshot. Returns a base64-encoded string. Options: `elementId` to capture a specific element, `fullPage` to capture the entire scrollable page.

### `upload(id, filePaths)`

```typescript
upload(id: string, filePaths: string[]): Promise<void>
```

Sets files on a `<input type="file">` element via CDP. The tool wrapper version accepts a single `filePath` string and passes it through to this method. Uploads are confined to `fileAccessRoots`, which default to the current working directory and the OS temp directory.

### `clipboardRead()`

```typescript
clipboardRead(): Promise<string>
```

Reads the current clipboard text content.

Read-only sessions do not expose this method.

### `clipboardWrite(text)`

```typescript
clipboardWrite(text: string): Promise<void>
```

Writes text to the system clipboard.

### `download(id, options?)`

```typescript
download(id: string, options?: { downloadDir?: string; timeout?: number }): Promise<DownloadResult>
```

Clicks a download link/button and waits for the file to download. Returns the file path, name, and size. Custom `downloadDir` paths must stay inside `fileAccessRoots`, which default to the current working directory and the OS temp directory.

## Tool definitions

`getToolDefinitions()` returns 18 provider-neutral tools mapped to the methods above.

The `get_state` tool description informs the LLM that elements in `~~strikethrough~~` are disabled or inert and should not be passed to interaction tools like `click`, `type`, or `select`.

| Tool | Parameters | Description |
|---|---|---|
| `get_state` | `maxTokens?`, `viewport?`, `mode?`, `includeHidden?` | Get the compressed page state |
| `navigate` | `url` | Navigate to a URL |
| `click` | `id` | Click an element by its TideSurf ID |
| `type` | `id`, `text`, `clear?` | Type text into an input field |
| `select` | `id`, `value` | Select an option from a dropdown |
| `scroll` | `direction`, `amount?` | Scroll the page up or down |
| `extract` | `selector` | Extract text content via CSS selector |
| `evaluate` | `expression` | Execute JavaScript in the page |
| `list_tabs` | none | List all open browser tabs |
| `new_tab` | `url?` | Open a new tab |
| `switch_tab` | `tabId` | Switch to a different tab |
| `close_tab` | `tabId` | Close a tab |
| `search` | `query`, `maxResults?` | Find text snippets on the page with nearest interactive IDs |
| `screenshot` | `elementId?`, `fullPage?` | Capture a PNG screenshot |
| `upload` | `id`, `filePath` | Set a file on a file input |
| `clipboard_read` | none | Read clipboard text |
| `clipboard_write` | `text` | Write text to clipboard |
| `download` | `id`, `downloadDir?`, `timeout?` | Download a file |
