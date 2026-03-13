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
| `cdpPort` | `number` | `9222` | Chrome DevTools Protocol port |
| `timeout` | `number` | `30000` | Default timeout in milliseconds |

### `navigate(url)`

```typescript
navigate(url: string): Promise<void>
```

Navigates the active tab to the given URL and waits for the page to load. Throws `NavigationError` if the URL is unreachable or `ValidationError` if the URL format is invalid.

### `getState(options?)`

```typescript
getState(options?: GetStateOptions): Promise<PageState>
```

Returns the compressed XML representation of the active tab's DOM. The returned `PageState` object contains an `xml` property with the compressed page content.

**Options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `maxTokens` | `number` | unlimited | Maximum token budget for the output |

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

Returns an array of 12 tool schemas formatted for LLM function calling. Pass these to your LLM's tool/function parameter so it knows which browser actions are available.

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

Scrolls the page in the given direction. The `amount` parameter controls how many viewport-heights to scroll (defaults to 1).

### `extract(selector)`

```typescript
extract(selector: string): Promise<string>
```

Extracts the text content of elements matching the given CSS selector. Useful for reading content that isn't included in the compressed XML output, or for targeting specific elements precisely.

### `navigate(url)`

```typescript
navigate(url: string): Promise<void>
```

Navigates the current page to a new URL. Equivalent to calling `browser.navigate()` but scoped to this page instance.

### `evaluate(expression)`

```typescript
evaluate(expression: string): Promise<unknown>
```

Executes arbitrary JavaScript in the page context and returns the result. Use with caution — this bypasses TideSurf's structured interaction model, but is useful for edge cases where the standard tools don't cover your needs.

---

## Tool definitions

These 12 tools are returned by `getToolDefinitions()` and can be used with any LLM that supports function calling. They map directly to the methods above:

| Tool | Parameters | Description |
|---|---|---|
| `get_state` | `maxTokens?` | Get the compressed page state as XML |
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
