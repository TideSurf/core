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
| `D` | Dialogs | `D1` |

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

## Element state flags

TideSurf serializes the runtime state of interactive elements directly into the compressed output, so the agent knows which elements are actionable and which are not. State flags appear inline after the element ID.

### Buttons

Buttons include state flags after the closing bracket:

```
[B1] Submit disabled
[B2] Menu expanded
[B3] Menu collapsed
```

- `disabled` — the button cannot be clicked (HTML `disabled` attribute or computed disabled state)
- `expanded` — the button controls an expanded region (from `aria-expanded="true"`)
- `collapsed` — the button controls a collapsed region (from `aria-expanded="false"`)

### Links

Links show state flags after the text content:

```
[L1](/url →) text           # target="_blank" (opens in new tab)
[L2](/url) text disabled    # link is disabled
[L3](/url) text expanded    # link controls an expanded region
[L4](/url) text collapsed   # link controls a collapsed region
```

The `→` suffix inside the parentheses indicates `target="_blank"`.

### Inputs

Inputs display constraint attributes as inline flags:

```
I1 ~Placeholder ="value"
I2:number ~Amount ="10" min=0 max=100 step=5
I3:text ~Code ="" pattern=[A-Z]{3}
I4 ~Name ="Alice" disabled
I5 ~Notes ="..." readonly
I6 ~Email ="" required
I7:checkbox checked
```

Flags include `disabled`, `readonly`, `required`, `checked` (for checkboxes/radios), and the constraint attributes `min=X`, `max=X`, `step=X`, and `pattern=X` when present.

### Selects

Select dropdowns show their state and selected option:

```
S1
  > Option A
  Option B
  Option C
```

- `disabled` — the select cannot be interacted with
- `required` — a selection is required
- `multiple` — multiple options can be selected
- `>` prefix marks the currently selected option(s)

Option groups are preserved with their labels, and individual options within a group can also be disabled.

## Computed state flags

In addition to HTML attribute-based state, TideSurf inspects computed CSS styles and DOM structure to detect elements that appear interactive but are not actually usable. These computed states appear as flags in the serialized output:

- **`disabled`** (computed) — The element is inside a disabled `<fieldset>` or has been disabled via JavaScript even though the HTML attribute is not set. TideSurf resolves the effective disabled state by walking the DOM ancestry.
- **`obscured`** — The element is behind an overlay (modal backdrop, cookie banner, etc.). TideSurf checks whether another element at the same coordinates would receive the click via `elementFromPoint` logic.
- **`inert`** — The element has `pointer-events: none` in computed CSS, or is inside an HTML `inert` subtree. The element is visible but non-interactive.

These flags help agents avoid wasting actions on elements that will not respond to clicks or input.
