# Multi-tab

TideSurf supports multiple browser tabs with independent state, letting your agent work across several pages simultaneously — useful for tasks like comparing search results, cross-referencing documentation, or managing multiple workflows in parallel.

## Opening and managing tabs

```typescript
// Open a new tab and navigate to a URL
const tab = await browser.newTab("https://example.com");

// Open a blank tab (navigates later)
const blankTab = await browser.newTab();
await browser.navigate("https://docs.example.com");

// List all open tabs with their IDs and URLs
const tabs = await browser.listTabs();
// → [{ id: "abc123", url: "https://example.com", title: "Example" }, ...]

// Switch the active tab
await browser.switchTab(tabs[0].id);

// Close a specific tab
await browser.closeTab(tab.id);
```

## How tab state works

Each tab maintains its own independent state — its own URL, DOM tree, navigation history, and element ID assignments. When you call `getState()`, it always returns the state of the currently active tab. Switching tabs changes which page all subsequent operations (click, type, scroll, navigate) apply to.

This means an agent can open a reference page in one tab, switch to a form in another tab, fill out the form using information from the reference page, and then close the reference tab — all through the same TideSurf instance.

```typescript
// Example: cross-reference between two pages
await browser.newTab("https://docs.example.com/api");
const docsState = await browser.getState();
// Agent reads API details from docsState.content

await browser.switchTab(originalTabId);
await page.type("I1", valueFromDocs);
await page.click("B1");
```

## Tab lifecycle

Tabs persist until explicitly closed or until the entire browser session ends via `browser.close()`. There is no automatic tab cleanup, so if your agent opens many tabs over time, you should close the ones it no longer needs to keep resource usage reasonable.

When a tab is closed, its state is discarded and its tab ID becomes invalid. Attempting to switch to a closed tab will throw an error.

## Tool definitions for multi-tab

When using TideSurf's tool definitions with an LLM, four tab-related tools are available:

| Tool | Parameters | What it does |
|---|---|---|
| `list_tabs` | — | Returns an array of all open tabs with their IDs, URLs, and titles |
| `new_tab` | `url?` | Opens a new tab, optionally navigating to the given URL |
| `switch_tab` | `tabId` | Switches the active tab to the one with the given ID |
| `close_tab` | `tabId` | Closes the tab with the given ID |
