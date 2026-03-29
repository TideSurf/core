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

## Element state

TideSurf serializes element state directly into the compressed output using conventions that LLMs understand natively from markdown pre-training.

### Quick reference

| Format | Meaning |
|---|---|
| `[B1] Submit` | Normal, clickable button |
| `~~[B1] Submit~~` | Disabled or inert — do not interact |
| `[B1] Submit obscured` | Behind an overlay — dismiss blocker first |
| `[B1] Menu open` | Toggle is expanded |
| `[B1] Menu closed` | Toggle is collapsed |
| `[L1](/url →) text` | Link opens in new tab |
| `> Option` | Currently selected option in a select |

### Disabled and inert elements — `~~strikethrough~~`

Elements that cannot receive interaction are wrapped in markdown `~~strikethrough~~`. An agent should never pass a struck-through element's ID to `click`, `type`, or `select` — the browser will either ignore the action or throw an error.

```
~~[B1] Submit~~              # button has disabled attribute
~~[L1](/url) Click here~~    # link has aria-disabled="true"
~~I1 ~Email~~                # input is disabled
~~S1:select~~                # select is disabled
~~[B2] Save~~                # inert (pointer-events:none or HTML inert)
```

The strikethrough convention covers multiple underlying causes — the HTML `disabled` attribute, `aria-disabled="true"`, inherited disabled state from a `<fieldset disabled>` ancestor, CSS `pointer-events: none`, and the HTML `inert` attribute. From the agent's perspective, the reason doesn't matter: `~~` means "don't touch it."

### Toggle state — `open` / `closed`

Buttons and links that control expandable regions show their toggle state:

```
[B1] Menu open               # aria-expanded="true"
[B2] Settings closed          # aria-expanded="false"
~~[B3] Options closed~~       # disabled AND collapsed
```

### Obscured elements — `obscured`

Elements behind overlays (modals, cookie banners) are still actionable but blocked. The agent should dismiss the overlay first:

```
[B1] Submit obscured          # behind an overlay
```

### Links with target

Links that open in a new tab show `→` inside the href:

```
[L1](/docs →) Documentation   # target="_blank"
```

### Input constraints

Inputs display their validation constraints inline:

```
I1 ~Placeholder ="value"
I2:number ~Amount ="10" min=0 max=100 step=5
I3:text ~Code ="" pattern=[A-Z]{3}
I4 ~Notes ="..." readonly
I5 ~Email ="" required
I6:checkbox checked
```

### Select options

Select dropdowns show `>` for the selected option, plus `required`/`multiple` flags:

```
S1:select required
  > Option A
  Option B
  Option C
S2:select multiple
  > Apple
  > Banana
  Cherry
```

## Computed visibility

Before serializing the DOM, TideSurf inspects each element's computed CSS styles to filter out anything that isn't actually visible or usable on the page. The following properties are checked:

| CSS property | Filtered when |
|---|---|
| `display` | `none` |
| `visibility` | `hidden` or `collapse` |
| `opacity` | `0` |
| `clip-path` | Element is clipped to zero area |
| `pointer-events` | `none` (element is marked as inert/`~~strikethrough~~` instead of removed) |

This filtering prevents agents from interacting with honeypot fields, off-screen traps, or CSS-hidden elements that are present in the DOM but not visible to a real user.

Use `getState({ includeHidden: true })` to bypass this filtering for debugging — for example, to inspect hidden menus, lazy-loaded content, or off-screen elements before they become visible.
