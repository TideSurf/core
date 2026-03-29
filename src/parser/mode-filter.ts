import type { OSNode } from "../types.js";

/**
 * Check whether any node in the subtree has an `id` field (is interactive).
 */
function hasInteractiveDescendant(node: OSNode): boolean {
  if (node.id) return true;
  return node.children.some(hasInteractiveDescendant);
}

/**
 * Filter to only interactive elements and their ancestors.
 * - Nodes with an `id` are kept fully.
 * - Ancestor nodes (no id themselves) keep tag/attributes but lose direct text.
 * - #text nodes not inside an interactive element are removed.
 */
export function filterInteractive(nodes: OSNode[]): OSNode[] {
  const result: OSNode[] = [];

  for (const node of nodes) {
    if (node.id) {
      // This node is interactive — keep it and its entire subtree
      result.push(node);
      continue;
    }

    if (node.tag === "#text") {
      // Top-level text with no interactive ancestor — discard
      continue;
    }

    // Check if any descendant is interactive
    if (!hasInteractiveDescendant(node)) {
      continue;
    }

    // This node is an ancestor of interactive elements.
    // Keep its structure but strip its own direct text content.
    const filteredChildren = filterInteractive(node.children);
    result.push({
      tag: node.tag,
      id: node.id,
      attributes: { ...node.attributes },
      children: filteredChildren,
      visible: node.visible,
      state: node.state,
      // Intentionally omit text — ancestor-only nodes lose direct text
    });
  }

  return result;
}

/**
 * Tags considered landmark/structural containers for minimal mode.
 */
const LANDMARK_TAGS = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "heading",
  "nav",
  "section",
  "form",
  "main",
  "header",
  "footer",
  "article",
  "aside",
]);

/**
 * Count interactive children by prefix type.
 */
export function countInteractiveChildren(
  node: OSNode
): Record<string, number> {
  const counts: Record<string, number> = {};

  function walk(n: OSNode): void {
    if (n.id) {
      const prefix = n.id.replace(/\d+$/, "");
      let label: string;
      switch (prefix) {
        case "L":
          label = "links";
          break;
        case "B":
          label = "buttons";
          break;
        case "I":
          label = "inputs";
          break;
        case "S":
          label = "selects";
          break;
        default:
          label = "interactive";
      }
      counts[label] = (counts[label] ?? 0) + 1;
    }
    for (const child of n.children) {
      walk(child);
    }
  }

  for (const child of node.children) {
    walk(child);
  }

  return counts;
}

/**
 * Collect all descendant text content from a subtree.
 */
export function collectText(node: OSNode): string {
  const parts: string[] = [];

  function walk(n: OSNode): void {
    if (n.text) parts.push(n.text);
    for (const child of n.children) {
      walk(child);
    }
  }

  walk(node);
  return parts.join(" ");
}

/**
 * Build an interactive summary string like "[3 links, 1 button, 2 inputs]".
 */
export function interactiveSummary(counts: Record<string, number>): string {
  const parts: string[] = [];
  for (const [label, count] of Object.entries(counts)) {
    if (count > 0) {
      parts.push(`${count} ${count === 1 ? label.replace(/s$/, "") : label}`);
    }
  }
  return parts.length > 0 ? `[${parts.join(", ")}]` : "";
}

/**
 * Minimal filter: keep only landmark/structural containers with summaries.
 * - Keeps: h1-h6, heading, nav, section, form, main, header, footer, article, aside
 * - For each kept container: counts interactive children, includes first ~100 chars of text
 * - Discards everything else
 */
export function filterMinimal(nodes: OSNode[]): OSNode[] {
  const result: OSNode[] = [];

  for (const node of nodes) {
    if (node.tag === "#text") {
      // Discard top-level text nodes in minimal mode
      continue;
    }

    if (LANDMARK_TAGS.has(node.tag)) {
      // This is a landmark — summarize it
      const counts = countInteractiveChildren(node);
      const summary = interactiveSummary(counts);
      const text = collectText(node).slice(0, 100).trim();

      const summaryParts: string[] = [];
      if (text) summaryParts.push(text);
      if (summary) summaryParts.push(summary);

      result.push({
        tag: node.tag,
        attributes: { ...node.attributes },
        children: [],
        text: summaryParts.join(" ") || undefined,
      });
      continue;
    }

    // Not a landmark — recurse into children to find nested landmarks
    const childLandmarks = filterMinimal(node.children);
    if (childLandmarks.length > 0) {
      result.push(...childLandmarks);
    }
  }

  return result;
}
