# Page format

`readPage()` returns compact text containing usable controls, semantic structure, and visible copy from the live page.

## Before and after

A small navigation and search form still carries classes, wrappers, roles, and layout attributes that add tokens without adding useful actions:

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

TideSurf keeps the meaning and live controls:

```
# Example Search
> example.com/search | 0/1200 800vh

NAV
  [L1](/) Home
  [L2](/about) About

FORM F1
  I1 ~Search... ="TideSurf"
  [B1] Search
```

## Element ID scheme

Supported controls and selected structural containers receive short IDs. Control IDs identify targets for compatible actions such as `click("B1")` and `type("I1", "query")`. Structural IDs preserve relationships and can anchor search results; they do not imply a matching form, table, or dialog action. The prefix identifies the element type:

| Prefix | Element type | Example |
|---|---|---|
| `L` | Links (`<a>` tags) | `L1`, `L2`, `L14` |
| `B` | Buttons | `B1`, `B2` |
| `I` | Inputs and textareas | `I1`, `I3` |
| `S` | Select dropdowns | `S1` |
| `F` | Forms | `F1` |
| `T` | Tables | `T1` |
| `D` | Dialogs | `D1` |

TideSurf assigns IDs from top to bottom: `L1` is the first link and `B3` is the third button. IDs belong to one state snapshot and can shift after navigation or a dynamic update. Read fresh state before acting on a changed page.

## What gets stripped vs preserved

The compressor removes presentation and keeps meaning:

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

**Images** become `[img: alt text]`; `src` stays out of the output.

**Open shadow DOM** is traversed automatically. Closed roots remain inaccessible.

**Cross-origin iframes** remain inaccessible under browser security rules and appear as `[iframe: inaccessible]`.

**Headings** keep their hierarchy as `#`, `##`, and `###`.

## Element state

Element state appears inline through familiar text conventions.

**Quick reference**

| Format | Meaning |
|---|---|
| `[B1] Submit` | Normal, clickable button |
| `~~[B1] Submit~~` | Disabled or inert: do not interact |
| `[B1] Menu open` | Toggle is expanded |
| `[B1] Menu closed` | Toggle is collapsed |
| `[L1](/url →) text` | Link opens in new tab |
| `> Option` | Currently selected option in a select |

**Disabled and inert: `~~strikethrough~~`**

Unavailable elements use `~~strikethrough~~`. Do not pass their IDs to `click`, `type`, or `select`.

```
~~[B1] Submit~~              # button has disabled attribute
~~[L1](/url) Click here~~    # link has aria-disabled="true"
~~I1 ~Email~~                # input is disabled
~~S1:select~~                # select is disabled
~~[B2] Save~~                # inert (pointer-events:none or HTML inert)
```

This formatting covers `disabled`, `aria-disabled="true"`, `<fieldset disabled>`, `pointer-events: none`, and `inert`. `~~` means the control is not actionable.

**Toggle state: `open` / `closed`**

Expandable controls show their toggle state:

```
[B1] Menu open               # aria-expanded="true"
[B2] Settings closed          # aria-expanded="false"
~~[B3] Options closed~~       # disabled AND collapsed
```

Page reads omit paint-order obscuration. DOMSnapshot geometry does not prove which painted element receives a hit, so TideSurf does not guess. Use a screenshot when overlay state matters.

**Links with a target**

Links opening a new tab include `→` inside the href:

```
[L1](/docs →) Documentation   # target="_blank"
```

**Input constraints**

Inputs display their validation constraints inline:

```
I1 ~Placeholder ="value"
I2:number ~Amount ="10" min=0 max=100 step=5
I3:text ~Code pattern=[A-Z]{3}
I4 ~Notes ="..." readonly
I5 ~Email required
I6:checkbox checked
```

**Select options**

Selects mark chosen options with `>` and retain `required` or `multiple`:

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

TideSurf checks computed styles before serialization:

| CSS property | Result |
|---|---|
| `display` | `none` |
| `visibility` | `hidden` or `collapse` |
| `content-visibility` | `hidden` |
| `opacity` | Below `0.01` |
| `clip-path` | Element is clipped to zero area |
| `pointer-events` | `none` (element is marked as inert/`~~strikethrough~~` instead of removed) |

This keeps CSS-hidden elements, honeypots, and off-screen traps out of the agent surface.

`readPage({ includeHidden: true })` is a full-DOM debugging override. It includes CSS-hidden, `hidden`, `aria-hidden`, and offscreen nodes, and disables viewport filtering even when `viewport: true` is also supplied.
