import type { CDPConnection } from "./connection.js";
import { evaluate } from "./connection.js";

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
  // Clear previous marks
  document.querySelectorAll('[data-os-visible]').forEach(el => el.removeAttribute('data-os-visible'));
  // Mark visible elements
  const all = document.querySelectorAll('*');
  for (const el of all) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    if (rect.bottom >= 0 && rect.top <= vh && rect.right >= 0 && rect.left <= vw) {
      el.setAttribute('data-os-visible', '1');
    }
  }
})()`
  );
}
