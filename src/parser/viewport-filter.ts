import type { OSNode } from "../types.js";
import { countInteractiveChildren, interactiveSummary, collectText } from "./mode-filter.js";

export interface ViewportFilterResult {
  nodes: OSNode[];
  aboveSummary?: OSNode;
  belowSummary?: OSNode;
}

/**
 * Check whether any node in the subtree has `visible === true`.
 */
function hasVisibleDescendant(node: OSNode): boolean {
  if (node.visible) return true;
  return node.children.some(hasVisibleDescendant);
}

/**
 * Summarize a list of off-screen nodes into a single summary node.
 */
function summarizeRegion(nodes: OSNode[], tag: "above" | "below"): OSNode | undefined {
  if (nodes.length === 0) return undefined;

  const parts: string[] = [];
  for (const node of nodes) {
    if (node.tag === "#text") continue;
    const counts = countInteractiveChildren(node);
    const summary = interactiveSummary(counts);
    const text = collectText(node).slice(0, 50).trim();
    const label = node.tag;

    // Format: "tag: text [N interactive]" or "tag [N interactive]" or "tag: text"
    let desc = label;
    if (text) desc += `: ${text}`;
    if (summary) desc += ` ${summary}`;
    parts.push(desc);
  }

  if (parts.length === 0) return undefined;

  return {
    tag,
    attributes: {},
    children: [],
    text: parts.slice(0, 5).join(", ") + (parts.length > 5 ? `, ...${parts.length - 5} more` : ""),
  };
}

/**
 * Filter to only nodes visible in the current viewport (or ancestors of visible nodes).
 * Returns visible nodes plus summaries of above/below off-screen regions.
 */
export function filterViewportOnly(nodes: OSNode[]): ViewportFilterResult {
  // Find first and last visible node indices
  let firstVisibleIdx = -1;
  let lastVisibleIdx = -1;

  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].visible || hasVisibleDescendant(nodes[i])) {
      if (firstVisibleIdx === -1) firstVisibleIdx = i;
      lastVisibleIdx = i;
    }
  }

  if (firstVisibleIdx === -1) {
    // Nothing visible
    return { nodes: [] };
  }

  // Build above/below regions
  const aboveNodes = nodes.slice(0, firstVisibleIdx);
  const belowNodes = nodes.slice(lastVisibleIdx + 1);

  // Filter the visible region
  const visibleRegion = nodes.slice(firstVisibleIdx, lastVisibleIdx + 1);
  const filtered = filterVisible(visibleRegion);

  return {
    nodes: filtered,
    aboveSummary: summarizeRegion(aboveNodes, "above"),
    belowSummary: summarizeRegion(belowNodes, "below"),
  };
}

/**
 * Recursively filter to visible nodes and their ancestors.
 */
function filterVisible(nodes: OSNode[]): OSNode[] {
  const result: OSNode[] = [];

  for (const node of nodes) {
    if (node.visible) {
      result.push(node);
      continue;
    }

    if (node.tag === "#text") {
      continue;
    }

    if (!hasVisibleDescendant(node)) {
      continue;
    }

    const filteredChildren = filterVisible(node.children);
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
