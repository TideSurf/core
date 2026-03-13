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
 * Uses getBoundingClientRect to check if any part of the element is in the viewport.
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

    const rect = el.getBoundingClientRect();
    if (
      !(rect.width === 0 && rect.height === 0) &&
      rect.bottom >= 0 &&
      rect.top <= vh &&
      rect.right >= 0 &&
      rect.left <= vw
    ) {
      el.setAttribute('data-os-visible', '1');
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
