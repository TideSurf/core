import type { OSNode } from "../types.js";
import { countInteractiveChildren, interactiveSummary, collectText } from "./mode-filter.js";

export interface ViewportFilterResult {
  nodes: OSNode[];
  aboveSummary?: OSNode;
  belowSummary?: OSNode;
}

const MAX_FILTER_DEPTH = 500;

/**
 * Check whether any node in the subtree has `visible === true`.
 * Uses memoization to avoid redundant traversals.
 */
function hasVisibleDescendant(node: OSNode, depth: number = 0, cache = new Map<OSNode, boolean>()): boolean {
  if (depth > MAX_FILTER_DEPTH) return false;
  if (cache.has(node)) return cache.get(node)!;
  
  const result = node.visible || node.children.some(child => hasVisibleDescendant(child, depth + 1, cache));
  cache.set(node, result);
  return result;
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
 * 
 * MED-001 Optimization: Uses shared memoization cache to avoid double traversal.
 * Single-pass combined check reduces complexity from O(2n) to O(n).
 */
export function filterViewportOnly(nodes: OSNode[]): ViewportFilterResult {
  // Shared cache for all hasVisibleDescendant calls in this filter operation
  const visibilityCache = new Map<OSNode, boolean>();
  
  // Find first and last visible node indices
  let firstVisibleIdx = -1;
  let lastVisibleIdx = -1;

  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].visible || hasVisibleDescendant(nodes[i], 0, visibilityCache)) {
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

  // Filter the visible region - reuse the same cache for efficiency
  const visibleRegion = nodes.slice(firstVisibleIdx, lastVisibleIdx + 1);
  const filtered = filterVisible(visibleRegion, 0, visibilityCache);

  return {
    nodes: filtered,
    aboveSummary: summarizeRegion(aboveNodes, "above"),
    belowSummary: summarizeRegion(belowNodes, "below"),
  };
}

/**
 * Recursively filter to visible nodes and their ancestors.
 * 
 * MED-001 Optimization: Uses shared memoization cache from parent operation
 * to avoid redundant subtree traversal. Single pass combined check.
 */
function filterVisible(nodes: OSNode[], depth: number = 0, cache = new Map<OSNode, boolean>()): OSNode[] {
  if (depth > MAX_FILTER_DEPTH) return [];

  const result: OSNode[] = [];

  for (const node of nodes) {
    if (node.visible) {
      result.push(node);
      continue;
    }

    if (node.tag === "#text") {
      continue;
    }

    // Use cached visibility check if available
    if (!hasVisibleDescendant(node, depth + 1, cache)) {
      continue;
    }

    const filteredChildren = filterVisible(node.children, depth + 1, cache);
    result.push({
      tag: node.tag,
      id: node.id,
      attributes: { ...node.attributes },
      children: filteredChildren,
      text: node.text,
      visible: node.visible,
      state: node.state,
    });
  }

  return result;
}
