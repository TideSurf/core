# Page format

When you call `getState()`, TideSurf walks the live DOM tree, strips away everything an LLM doesn't need, and produces a compact text representation that preserves only the parts that matter: interactive elements, semantic structure, and visible text.

## Before and after

Consider a typical page fragment with navigation and a search form. The raw HTML carries a significant amount of presentational markup — CSS classes, wrapper divs, ARIA roles, and layout attributes — that inflates token usage without adding information the LLM can act on:

```html
<div class="header">
  <nav class="main-nav" role="navigation">
    <ul class="nav-list">
      <li class="nav-item"><a href="/" class="nav-link active">Home</a></li>
      <li class="nav-item"><a href="/about" class="nav-link">About</a></li>
    </ul>
  </nav>
</div>
<div class="search-container">
  <form id="search-form" action="/search" method="GET">
    <div class="input-wrapper">
      <input type="text" name="q" placeholder="Search..." value="TideSurf" />
      <button type="submit" class="btn btn-primary">Search</button>
    </div>
  </form>
</div>
```

TideSurf compresses this into a handful of tokens while retaining everything an agent needs to understand and interact with the page:

```
# Example Search
> example.com/search

NAV
  [L1](/) Home
  [L2](/about) About

FORM F1
  I1 ~Search... ="TideSurf"
  [B1] Search
```

## Element ID scheme

Every interactive element in the output receives a short, prefixed ID that your agent can reference when performing actions like `click("B1")` or `type("I1", "query")`. The prefix indicates the element type:

| Prefix | Element type | Example |
|---|---|---|
| `L` | Links (`<a>` tags) | `L1`, `L2`, `L14` |
| `B` | Buttons | `B1`, `B2` |
| `I` | Text inputs, textareas | `I1`, `I3` |
| `S` | Select dropdowns | `S1` |
| `F` | Forms | `F1` |
| `T` | Tables | `T1` |

IDs are assigned sequentially as TideSurf traverses the DOM from top to bottom, so `L1` is always the first link on the page and `B3` is the third button. These IDs are stable within a single `getState()` call but may shift between calls if the page content changes (for example, after navigating or triggering a dynamic UI update).

## What gets stripped vs preserved

TideSurf applies a clear set of rules to decide what stays and what goes:

| Stripped | Preserved |
|---|---|
| CSS classes and inline styles | Interactive elements (links, buttons, inputs, selects) |
| Wrapper `<div>`s and `<span>`s with no semantic meaning | Semantic structure (nav, form, section, heading hierarchy) |
| `data-*` attributes and event handlers | Visible text content |
| `<script>` and `<style>` tags | Element IDs auto-assigned by TideSurf |
| Redundant nesting levels | Form relationships and input values |
| Hidden elements (`display: none`, `aria-hidden`) | Image `alt` text |
| SVG internals, icon fonts | Table structure (rows, columns, headers) |

## Special cases

**Images** are preserved as `[img: alt text]`, but `src` is omitted to save tokens — the alt text is usually sufficient for an LLM to understand what the image represents.

**Shadow DOM** is pierced automatically, so elements inside web components appear in the output as if they were part of the regular DOM tree.

**Cross-origin iframes** cannot be accessed due to browser security restrictions and appear as `[iframe: inaccessible]` in the output.

**Headings** maintain their hierarchy using markdown heading markers (`#`, `##`, `###`) to give the LLM a sense of page structure and content organization.
