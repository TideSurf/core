import type { OSNode } from "../types.js";

/**
 * Check whether any node in the subtree has `visible === true`.
 */
function hasVisibleDescendant(node: OSNode): boolean {
  if (node.visible) return true;
  return node.children.some(hasVisibleDescendant);
}

/**
 * Filter to only nodes visible in the current viewport (or ancestors of visible nodes).
 * Removes entire subtrees where no descendant is visible.
 */
export function filterViewportOnly(nodes: OSNode[]): OSNode[] {
  const result: OSNode[] = [];

  for (const node of nodes) {
    if (node.visible) {
      // This node is visible — keep it and its entire subtree
      result.push(node);
      continue;
    }

    if (node.tag === "#text") {
      // Text nodes without visibility — discard
      continue;
    }

    // Check if any descendant is visible
    if (!hasVisibleDescendant(node)) {
      continue;
    }

    // This node is an ancestor of visible elements — recurse
    const filteredChildren = filterViewportOnly(node.children);
    result.push({
      tag: node.tag,
      id: node.id,
      attributes: { ...node.attributes },
      children: filteredChildren,
      text: node.text,
      visible: node.visible,
    });
  }

  return result;
}
