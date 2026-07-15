# Multi-tab

One TideSurf instance can manage several tabs with independent state. Agents can compare results, cross-reference documentation, and move between workflows.

## Opening and managing tabs

```typescript
// Open a URL in a new tab
const tab = await browser.newTab("https://example.com");

// Open a blank tab
const blankTab = await browser.newTab();
await browser.navigate("https://docs.example.com");

// List tabs
const tabs = await browser.listTabs();
// → [{ id: "abc123", url: "https://example.com", title: "Example" }, ...]

// Switch the active tab
await browser.switchTab(tabs[0].id);

// Close a tab
await browser.closeTab(tab.id);
```

## How tab state works

Each tab keeps its own URL, DOM, history, and element IDs. `readPage()` reads the active tab. Retrieve `browser.getPage()` after switching; a cached `SurfingPage` stays tied to the tab where it was created.

For example, an agent can read a reference page, switch to a form, enter the referenced value, and close the reference tab.

```typescript
// Cross-reference two pages
await browser.newTab("https://docs.example.com/api");
const docsState = await browser.readPage();
// Agent reads API details from docsState.content

await browser.switchTab(originalTabId);
const page = browser.getPage();
await page.type("I1", valueFromDocs);
await page.click("B1");
```

## Tab lifecycle

TideSurf tracks each tab until `closeTab()` or `browser.close()`. Closing a managed instance stops its owned browser and tabs. Closing an attached instance only disconnects; the external tabs remain open.

Closing a tab discards its state and invalidates its ID. A later `switchTab()` with that ID throws an error.

## Tool definitions for multi-tab

The agent tool surface includes four tab operations:

| Tool | Parameters | What it does |
|---|---|---|
| `list_tabs` | none | Return open tabs with IDs, URLs, and titles |
| `new_tab` | `url?` | Open a blank tab or a URL |
| `switch_tab` | `tabId` | Activate a tab |
| `close_tab` | `tabId` | Close a tab |
