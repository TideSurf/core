# API reference

## TideSurf

The main class that manages the browser lifecycle, tab management, and provides access to page-level operations.

### `TideSurf.launch(options?)`

```typescript
static launch(options?: TideSurfOptions): Promise<TideSurf>
```

Launches a new Chrome instance and connects to it via CDP. Returns a `TideSurf` instance ready for use. Automatically retries up to 3 times on connection failure.

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

Connects to an already-running Chrome instance via CDP. Does not launch or manage the Chrome process — `close()` will only disconnect CDP, not kill the browser.

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

**Throws:** `CDPConnectionError` if no Chrome instance is found on the specified port, with an actionable error message explaining how to enable remote debugging.

### `navigate(url)`

```typescript
navigate(url: string): Promise<void>
```

Navigates the active tab to the given URL and waits for the page to load. Throws `NavigationError` if the URL is unreachable or `ValidationError` if the URL format is invalid.

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

Modes compose: `getState({ viewport: true, mode: "interactive", maxTokens: 200 })` filters to visible interactive elements, then prunes to 200 tokens.

The internal `OSNode` tree used during serialization includes a `state` field on each node. This field carries the element's runtime state flags (e.g. `disabled`, `inert`, `obscured`, `checked`, `required`, `readonly`) and toggle state (`expanded`/`collapsed` from `aria-expanded`), which are serialized inline in the compressed output — disabled/inert as `~~strikethrough~~`, toggle as `open`/`closed` keywords. See the [page format](#page-format) documentation for details on how state flags appear in the text representation.

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

Each tool returns a specific response format. When using the tool executor or MCP, responses are wrapped appropriately. Direct SDK methods return the following:

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

Returns a `SurfingPage` instance for the currently active tab, which provides element-level interaction methods (click, type, scroll, etc.).

### `getToolExecutor()`

```typescript
getToolExecutor(): (tool: { name: string; input: Record<string, unknown> }) => Promise<ToolResult>
```

Returns a function that executes TideSurf tools by name. Designed for use in LLM agent loops — pass the tool call from your LLM directly to this executor.

### `getToolDefinitions()`

```typescript
getToolDefinitions(): ToolDefinition[]
```

Returns an array of 18 tool schemas formatted for LLM function calling. Pass these to your LLM's tool/function parameter so it knows which browser actions are available.

### Tab management

```typescript
listTabs(): Promise<TabInfo[]>          // List all open tabs
newTab(url?: string): Promise<TabInfo>  // Open a new tab
switchTab(tabId: string): Promise<void> // Switch active tab
closeTab(tabId: string): Promise<void>  // Close a tab
close(): Promise<void>                  // Shut down browser
```

---

## SurfingPage

Provides page-level interaction methods. Obtain an instance via `browser.getPage()`.

### `click(id)`

```typescript
click(id: string): Promise<void>
```

Clicks the element with the given TideSurf ID (e.g. `"B1"`, `"L3"`). Throws `ElementNotFoundError` if the ID doesn't exist in the current DOM.

### `type(id, text, clear?)`

```typescript
type(id: string, text: string, clear?: boolean): Promise<void>
```

Types text into an input or textarea identified by the given ID. When `clear` is `true`, the existing value is cleared before typing. Defaults to appending to the current value.

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

Extracts the text content of elements matching the given CSS selector. Useful for reading content that isn't included in the compressed output, or for targeting specific elements precisely.

### `navigate(url)`

```typescript
navigate(url: string): Promise<void>
```

Navigates the current page to a new URL. Equivalent to calling `browser.navigate()` but scoped to this page instance.

### `evaluate(expression)`

```typescript
evaluate(expression: string): Promise<unknown>
```

Executes arbitrary JavaScript in the page context and returns the result. Use with caution — this bypasses TideSurf's structured interaction model, but is useful for edge cases where the standard tools don't cover your needs. `evaluate` is not available when `readOnly: true` is enabled.

### `search(query, maxResults?)`

```typescript
search(query: string, maxResults?: number): Promise<SearchResult[]>
```

Finds text on the page (case-insensitive). Returns up to `maxResults` matches (default 10) with surrounding text context and the nearest interactive TideSurf ID when one exists.

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

This method is intentionally unavailable when `readOnly: true` is enabled.

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

---

## Tool definitions

These 18 tools are returned by `getToolDefinitions()` and can be used with any LLM that supports function calling. They map directly to the methods above.

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
| `list_tabs` | — | List all open browser tabs |
| `new_tab` | `url?` | Open a new tab |
| `switch_tab` | `tabId` | Switch to a different tab |
| `close_tab` | `tabId` | Close a tab |
| `search` | `query`, `maxResults?` | Find text snippets on the page with nearest interactive IDs |
| `screenshot` | `elementId?`, `fullPage?` | Capture a PNG screenshot |
| `upload` | `id`, `filePath` | Set a file on a file input |
| `clipboard_read` | — | Read clipboard text |
| `clipboard_write` | `text` | Write text to clipboard |
| `download` | `id`, `downloadDir?`, `timeout?` | Download a file |
