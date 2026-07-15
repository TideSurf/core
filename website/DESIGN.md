# TideSurf Website Design Contract

This is the source of truth for `website/landing`, `website/docs`, and shared
website styles.

## Reference

The visual reference is `../../../mercuriusdream.github.io`, especially
`src/styles/global.css`.

Borrow its compact reading rhythm, warm paper, plainspoken copy, square color
patches, and integrated utility controls. Do not copy its personal-site content
structure or every interaction literally.

## Visual Character

TideSurf is humane, exact, and quietly opinionated.

- Warm greyscale paper and near-black ink.
- TideSurf teal as the primary punctum.
- Muted green, gold, rust, rose, and violet only for small semantic patches.
- Square edges, flat fills, no decorative rules, shadows, glow, glass, or
  gradients.
- Code is evidence and instruction, never wallpaper.
- No generic card grids, metric badges, or ornamental dashboard chrome.

## Shared Foundation

Both sites import `website/shared/foundation.css`.

Light theme:

- `paper`: `#ECEDEA`
- `paper-2`: `#E0E1DD`
- `paper-3`: `#D2D3CF`
- `ink`: `#161716`

Dark theme:

- `paper`: `#1A1A18`
- `paper-2`: `#242422`
- `paper-3`: `#2E2E2C`
- `ink`: `#E8E9E6`

Typography:

- UI and prose: `Zalando Sans`, then `Gothic A1` and system fallbacks.
- Code only: `IBM Plex Mono`, then system monospace.
- Landing headings may use fluid sizing. Docs UI uses a fixed, compact scale.
- Prose measure stays between 65 and 75 characters where practical.

## Identity

- The primary mark is a solid square tide field with one deeper open waterline
  cut through its middle. The square is the glyph itself, not a container
  around the wordmark.
- The horizontal lockup pairs that mark with open `TideSurf` lettering:
  `Tide` in warm ink and `Surf` in teal. Product headers, README files,
  browser tabs, and social art reuse the exact tide geometry.
- Keep the lockup compact and free of gradients, shadows, containers, or
  detached alternate symbols.

## Patch Controls

`.patch-control` is the shared button and compact-link primitive.

- Flat color-mix background, square corners, medium weight.
- Hover changes fill and text color only.
- No hover scale, rotate, translate, bounce, or word replacement.
- Active state darkens the fill without moving the element.
- Keyboard focus inverts paper and ink as a clear square box. Underlines and
  decorative outlines stay out of the control language, but focus never
  disappears.
- Mobile hit areas are at least 44px.

Use the same primitive for navigation actions, theme and language controls,
copy buttons, documentation actions, and final calls to action.

The shared `light` / `dark` selector floats at bottom-left on both sites.

## Landing

The landing is a brand surface. Its first viewport belongs to the thesis,
install action, and global navigation; product proof begins below the fold.

Structure:

1. Thesis, first CLI command, and a direct link to the real output.
2. A raw-HTML to TideSurf-text specimen using the documented page format.
3. The live loop: read state, choose a handle, use the page.
4. Operational capabilities and guardrails as compact rows.
5. Final docs and install action.

The square wave field is a TideSurf-only signature. Keep it quiet and fixed
behind the page so no section edge can cut it off. Page depth darkens this one
flat canvas; scrolling back toward the top restores its starting tone.

Do not make sections invisible before an IntersectionObserver fires. Any reveal
is progressive enhancement and may only affect decoration.

## Documentation

Docs are a product surface. Familiar navigation and density are useful, but the
shell must still feel like TideSurf.

- Always show the `TideSurf / Docs` identity in the first viewport.
- Desktop navigation lives in the page margin as a slim reading index. It must
  not become a contrasting full-height app slab or a separate browse modal.
- Active navigation is a snug color patch, not a full-width selection bar.
- Hide the table of contents before the reading column becomes cramped.
- Mobile uses a compact branded top bar and an inert off-canvas drawer.
- The default shell language is English while documentation content is English.
  A saved manual language choice may still localize shell labels.
- Inline links, theme controls, and navigation use the same restrained patch
  vocabulary as the landing. Do not add a page-action slab or visible
  `copy page` / `llms.txt` toolbar beside every title.

## README And Copy

- The README is a compact product handoff, not a badge wall or a marketing
  microsite. Use only the headings needed to install, understand, and operate.
- Prefer direct declarative sentences. Reduce repeated conditional openings,
  stacked plural lists, ornamental blank lines, and Markdown dividers.
- Code and documented behavior stay exact even where prose becomes shorter.

## Responsive Checks

Verify all website work at:

- `390x844`
- `768x1024`
- `1000x900`
- `1440x1000`

At every width:

- No horizontal page overflow.
- No clipped titles, install commands, code shells, or navigation.
- Mobile controls have usable hit areas.
- The docs reading column does not collapse beside an unnecessary table of
  contents.
- Landing proof remains visible and understandable without animation.

## Performance And Motion

- Animate only state changes and the quiet landing wave field.
- Wheel, trackpad, touch, keyboard, and scrollbar input stay native. Browser
  smoothing is reserved for explicit anchor navigation.
- Use opacity or transform only when motion is necessary.
- No hover movement.
- Respect `prefers-reduced-motion` and `prefers-reduced-data`.
- Pause continuous animation when the page is hidden.
- Never hide primary content by default.
- Prefer short declarative copy. Avoid repeated `when` / `if` / `then` clauses
  and ornamental blank lines.

## Docs Code Rendering

Syntax highlighting must start from `textContent`, escape the source, and only
then insert highlight spans. Never run highlighting replacements over generated
`innerHTML`.

## Verification

Run both builds from the repository root:

```bash
bun run build:web:landing
bun run build:web:docs
```

Then inspect the four target viewports, both themes, keyboard focus, the docs
drawer, copy controls, theme persistence, and browser console output.
