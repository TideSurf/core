import type { CDPConnection } from "./connection.js";
import { evaluate } from "./connection.js";
import type { ScrollPosition, TideSurfOptions } from "../types.js";

export async function applyViewport(
  conn: CDPConnection,
  viewport: NonNullable<TideSurfOptions["defaultViewport"]>
): Promise<void> {
  await conn.Emulation.setDeviceMetricsOverride({
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: false,
  });
}

/**
 * Inject JS to mark elements visible in the viewport with data-os-visible="1".
 * Checks bounding rect, viewport intersection, and computed styles
 * (display, visibility, opacity, clip-path).
 * Interactive elements also get data-os-state with flags:
 * disabled, inert (pointer-events:none), obscured (covered by overlay).
 */
export async function markVisibleElements(conn: CDPConnection): Promise<void> {
  await evaluate(
    conn,
    `(() => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const stack = [];

  const pushRoot = (root) => {
    if (!root) return;
    if (root.nodeType === Node.DOCUMENT_NODE) {
      if (root.documentElement) stack.push(root.documentElement);
      return;
    }
    if (root.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
      for (const child of root.children) stack.push(child);
      return;
    }
    if (root.nodeType === Node.ELEMENT_NODE) {
      stack.push(root);
    }
  };

  pushRoot(document);

  while (stack.length > 0) {
    const el = stack.pop();
    if (!el || el.nodeType !== Node.ELEMENT_NODE) continue;

    el.removeAttribute('data-os-visible');
    el.removeAttribute('data-os-state');

    const rect = el.getBoundingClientRect();
    const cs = getComputedStyle(el);

    // Comprehensive visibility check
    const hasSize = !(rect.width === 0 && rect.height === 0);
    const inViewport = rect.bottom >= 0 && rect.top <= vh && rect.right >= 0 && rect.left <= vw;
    const notHiddenByCSS = cs.display !== 'none' &&
                            cs.visibility !== 'hidden' &&
                            parseFloat(cs.opacity) > 0.01;
    // clip-path check: common hiding patterns
    const notClipped = !cs.clipPath ||
                       (cs.clipPath !== 'inset(100%)' &&
                        cs.clipPath !== 'circle(0)' &&
                        cs.clipPath !== 'polygon(0 0, 0 0, 0 0)');

    if (hasSize && inViewport && notHiddenByCSS && notClipped) {
      el.setAttribute('data-os-visible', '1');
    }

    // Interaction state for interactive elements
    const isInteractive = el.matches('a, button, input, select, textarea, [role="button"], [role="link"], [role="textbox"], [role="listbox"]');

    if (isInteractive && el.hasAttribute('data-os-visible')) {
      const state = [];

      // Disabled check — el.matches(':disabled') handles fieldset inheritance natively
      if (el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true') {
        state.push('disabled');
      }

      // Pointer interactability
      if (cs.pointerEvents === 'none') {
        state.push('inert');
      }

      // Obscured check — is the center of this element covered by something else?
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      if (centerX >= 0 && centerX <= vw && centerY >= 0 && centerY <= vh) {
        const topEl = document.elementFromPoint(centerX, centerY);
        if (topEl && topEl !== el && !el.contains(topEl) && !topEl.contains(el)) {
          state.push('obscured');
        }
      }

      if (state.length > 0) {
        el.setAttribute('data-os-state', state.join(','));
      }
    }

    if (el.shadowRoot) {
      pushRoot(el.shadowRoot);
    }

    if (el.tagName === 'IFRAME') {
      try {
        pushRoot(el.contentDocument);
      } catch {
        // Cross-origin iframes are intentionally skipped.
      }
    }

    for (const child of el.children) {
      stack.push(child);
    }
  }
})()`
  );
}

/**
 * Get the current scroll position and viewport dimensions.
 */
export async function getScrollPosition(conn: CDPConnection): Promise<ScrollPosition> {
  const result = await evaluate(
    conn,
    `(() => ({
  scrollY: window.scrollY,
  scrollHeight: document.documentElement.scrollHeight,
  viewportHeight: window.innerHeight
}))()`
  );
  return result as ScrollPosition;
}
