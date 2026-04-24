# TideSurf Website Design Contract

This document is the source of truth for future agents editing `website/`.
Follow it before changing the landing page or docs UI.

## Product Context

TideSurf is for engineers and AI/LLM developers building browser agents.
The website should feel technical, refined, and efficient: dense enough for
serious builders, but calm enough to scan quickly.

The core message is:

- TideSurf connects agents to Chromium through CDP.
- TideSurf compresses live DOM into token-efficient text.
- Agents use stable element IDs to observe and act.
- No screenshots or vision-model workflow should be implied.

## Visual Direction

Use minimalist editorial tooling, not SaaS spectacle.

- Foundation: greyscale surfaces and text.
- Accent: TideSurf blue `#0055FF`, used as pinpoints only.
- Shape: tight radii, usually `3px`; product mock shells can reach `8px`.
- Depth: restrained material elevation only. No glow, no aura, no neon edge.
- Composition: left-aligned and asymmetric where possible.
- Code examples are content, not wallpaper.

Avoid:

- Purple/cyan gradients, gradient text, neon dark-mode accents.
- Hero metric circles or big stat-badge clusters.
- Decorative glassmorphism, bokeh, blobs, or glow outlines.
- Repeated icon-card grids as the main visual system.
- Real interactive controls inside decorative mock-ups.

## Typography

Landing uses:

- Body: `IBM Plex Sans`, then CJK fallbacks.
- Code: `IBM Plex Mono`, then system monospace.
- CJK: `Noto Sans JP` and `Noto Sans KR`.

Rules:

- Do not reintroduce Inter, Roboto, Arial, Open Sans, or system-default-only
  typography for the primary design.
- Keep letter spacing at `0` for normal headings and body text.
- Uppercase micro-labels may use positive tracking.
- Body text must stay readable at mobile sizes.
- Use weight and spacing for hierarchy before adding color.

## Color And Theme

All product UI color should come from CSS tokens in
`website/landing/src/style.css`.

Allowed accent behavior:

- Blue active state.
- Blue element-ID chips or one-pixel connectors.
- Blue focus indicator.
- Blue syntax emphasis for function/tool identifiers.

Syntax highlighting should remain greyscale + blue. Do not add green,
orange, purple, cyan, or red token categories unless the whole design system
is intentionally revised.

## Mock-Up Rules

The landing page mock-ups should communicate the real TideSurf loop:

1. Chat request.
2. Agent tool call or reasoning step.
3. Browser or compressed DOM state.

Hero mock-up:

- Use a live-page panel paired with compressed DOM output.
- Keep the story direct: live page element IDs map visibly to compressed DOM
  rows and a small tool-call rail. Avoid generic app-dashboard chrome.
- It may contain button-like shapes as visual samples, but they must not be
  focusable or clickable.
- On tablet/mobile, stack before any clipping occurs.
- Keep it visually quiet enough to support "Surf the Tide"; it should not
  overpower the headline.

Main usage mock-up:

- Three panes: `Chat`, `Agent`, `Browser`.
- Animate only transform, opacity, background, and color.
- Reduced motion must show a stable final state.

## Accessibility And Interaction

Required:

- Every real interactive element needs a visible keyboard focus state.
- Focus states may use a solid blue outline; never use glow.
- Touch targets should be at least `44px` in either the element or its hit area.
- Decorative mock controls must be spans or aria-hidden visual elements, not
  buttons or links.
- Hidden navigation and drawers must be removed from the focus order with
  `inert` or explicit tab index management while closed.
- Tabs must keep `role="tablist"`, `role="tab"`, `aria-selected`,
  `aria-controls`, roving `tabIndex`, and hidden panels in sync.
- Language switching should update visible labels and relevant aria labels.

## Responsive Rules

Use content-driven breakpoints. The hero mock-up has historically clipped at
tablet widths, so do not lower the stack breakpoint without testing.

Minimum checks before shipping:

- `390x844` phone portrait.
- `768x1024` tablet portrait.
- `1000x900` tablet/desktop transition.
- `1440x1000` desktop.

At every width:

- No horizontal overflow or hidden clipping of primary content.
- Hero title, install command, and mock-up must not overlap.
- Mock-up panels can stack, but core product story must remain present.

## Landing Main Structure

The landing `<main>` is intentionally organized as one technical narrative,
not as independent marketing sections. Future edits should preserve this
sequence:

1. Compression: raw HTML becomes compact TideSurf text.
2. Usage loop: chat/request, agent tool call, browser result.
3. Evidence: token and cost benchmark, integrated near the compression story.
4. Capabilities: tools, budgets, auto-connect, MCP as dense editorial rows,
   not another card grid.
5. Guardrails: read-only, filesystem, validation, local CDP as a compact
   production-readiness checklist.
6. Try It: tabbed install/use examples as the final action.

Keep the `story-band` model unless there is a full replacement design. Prefer
fewer section wrappers, stronger transitions between ideas, and one or two
high-quality mock-ups over many separate cards. Do not restore the old bento
feature grid, metric circles, or separated benchmark block as the main page
structure. The main page should feel like a developer can scan the full product
loop in under a minute.

Each `story-band` must include a visual explanation of its message, preferably
repo-native SVG that can animate with CSS. The current baseline is at least one
purposeful animation per band:

- Compression: DOM pruning and token reduction.
- Patterns: chat request, agent tool call, browser state.
- Features: one motion SVG per capability, not a static table.
- Security: write blocking and local CDP loop.
- Try It: install flow and tab switching.

Keep these visuals explanatory, not decorative. Use transform, opacity,
stroke-dashoffset, fill/color changes, and small background pulses only. Every
new animation needs a reduced-motion static state.

## Performance And Motion

Prefer CSS transform and opacity. Avoid `transition: all`.

Never make primary page content invisible by default for scroll-reveal effects.
Full-page screenshots, print/export, crawlers, slow scripts, and reduced-motion
users must see complete content without needing an IntersectionObserver to fire.
Reveal classes may add subtle enhancement, but the baseline state must render
visible content.

Do not use `content-visibility: auto` on major marketing sections unless
full-page screenshots, print/export, and visual-regression tools have been
verified. Stable rendering is more important than a marginal paint win here.

Animations should be calm:

- Short distances.
- No bounce or elastic easing.
- No decorative motion that competes with reading.
- Expensive decorative motion should be desktop-only, and should be skipped
  for reduced motion, reduced data, and compact mobile contexts.
- Respect `prefers-reduced-motion`.

## Docs Code Rendering

Syntax highlighting in docs must operate from `textContent`, escape the source,
and then insert highlight spans. Do not run regex replacements over `innerHTML`;
that can highlight attributes inside generated markup and leak strings like
`class="tk-str"` into visible code blocks.

## Verification Checklist

Run from `website/landing`:

```bash
bun run build
```

Then visually inspect local preview/dev server at desktop, tablet, and mobile
widths. Confirm:

- "Surf the Tide" remains the hero heading.
- No legacy console-framed usage UI remains.
- No metric circles return.
- Mock-up buttons are not in the keyboard tab order.
- Try It tabs work by click and arrow keys.
- Theme and language switches do not break layout.
