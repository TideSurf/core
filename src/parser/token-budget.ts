import type { OSNode } from "../types.js";
import { serialize } from "./serializer.js";

/**
 * MED-007: Fallback deep copy when structuredClone fails.
 */
function deepCopyNodes(nodes: OSNode[]): OSNode[] {
  return nodes.map(node => ({
    tag: node.tag,
    id: node.id,
    attributes: { ...node.attributes },
    children: deepCopyNodes(node.children),
    text: node.text,
    visible: node.visible,
    state: node.state ? [...node.state] : undefined,
  }));
}

/**
 * Estimate the number of tokens in a serialized string.
 * Uses a simple heuristic of ~4 characters per token.
 */
export function estimateTokens(xml: string, charsPerToken: number = 4): number {
  return Math.ceil(xml.length / charsPerToken);
}

/**
 * Estimate token size for a single OSNode without full serialization.
 * This is O(1) per node vs O(n) for full serialization.
 */
function estimateNodeTokens(node: OSNode): number {
  let size = node.tag.length + 2; // Tag name + brackets
  if (node.id) size += node.id.length + 3; // [id]
  for (const [k, v] of Object.entries(node.attributes)) {
    size += k.length + (v?.length ?? 0) + 3; // key=value
  }
  if (node.text) size += node.text.length;
  // Rough estimate for serialization overhead (indentation, newlines)
  size += 10;
  return Math.ceil(size / 4);
}

/**
 * Pre-calculate token sizes for all nodes in a list.
 * Returns a map of node reference to estimated token count.
 */
function preCalculateTokenSizes(nodes: OSNode[]): Map<OSNode, number> {
  const cache = new Map<OSNode, number>();
  
  function calculateSubtreeSize(node: OSNode): number {
    if (cache.has(node)) return cache.get(node)!;
    
    let size = estimateNodeTokens(node);
    for (const child of node.children) {
      size += calculateSubtreeSize(child);
    }
    
    cache.set(node, size);
    return size;
  }
  
  for (const node of nodes) {
    calculateSubtreeSize(node);
  }
  
  return cache;
}

interface PruneOptions {
  maxTokens: number;
  charsPerToken?: number;
}

/**
 * Score a subtree for priority-based pruning.
 * Interactive nodes (with IDs) get highest priority,
 * visible nodes get medium, the rest get low.
 */
function scoreSubtree(node: OSNode): number {
  if (node.tag === "#text") return 1;
  let score = 0;
  if (node.id) score += 100;
  if (node.visible) score += 50;
  if (node.text) score += 10;
  for (const child of node.children) {
    score += scoreSubtree(child);
  }
  return score || 1;
}

/**
 * Prune children of a single container node to fit a budget.
 * Used when top-level pruning can't help because the page is
 * dominated by one large container (e.g. a single <main>).
 * 
 * Uses pre-calculated token sizes for O(n log n) complexity instead of O(n²).
 */
function pruneChildren(node: OSNode, maxTokens: number, charsPerToken: number): OSNode {
  if (node.children.length === 0) return node;

  interface Scored {
    node: OSNode;
    score: number;
    originalIndex: number;
    tokenSize: number;
  }

  // Pre-calculate token sizes for O(1) lookup
  const tokenSizeMap = preCalculateTokenSizes(node.children);

  const scored: Scored[] = node.children.map((child, i) => ({
    node: child,
    score: scoreSubtree(child),
    originalIndex: i,
    tokenSize: tokenSizeMap.get(child) ?? estimateNodeTokens(child),
  }));

  scored.sort((a, b) => b.score - a.score);

  const kept: Scored[] = [];
  let removedCount = 0;
  let currentTokens = estimateNodeTokens(node); // Base size of parent node

  for (const item of scored) {
    const tentativeSize = currentTokens + item.tokenSize;

    if (tentativeSize <= maxTokens * charsPerToken) {
      kept.push(item);
      currentTokens = tentativeSize;
    } else {
      removedCount++;
    }
  }

  kept.sort((a, b) => a.originalIndex - b.originalIndex);
  const children = kept.map((s) => s.node);

  if (removedCount > 0) {
    children.push({
      tag: "truncated",
      attributes: { count: String(removedCount) },
      children: [],
    });
  }

  return { ...node, children };
}

/**
 * Prune a list of OSNodes to fit within a token budget.
 * Removes lowest-priority top-level subtrees first,
 * then recurses into large containers if needed.
 * Returns a new array (does not mutate input).
 * 
 * Uses pre-calculated token sizes for O(n log n) complexity instead of O(n²).
 */
export function pruneToFit(
  nodes: OSNode[],
  options: PruneOptions
): OSNode[] {
  const { maxTokens, charsPerToken = 4 } = options;

  // Pre-calculate token sizes for O(1) lookup instead of O(n) serialization
  const tokenSizeMap = preCalculateTokenSizes(nodes);
  
  // Check if already under budget using pre-calculated sizes
  const totalSize = nodes.reduce((sum, node) => sum + (tokenSizeMap.get(node) ?? 0), 0);
  if (Math.ceil(totalSize / charsPerToken) <= maxTokens) {
    return nodes;
  }

  // Deep clone so we don't mutate input
  // MED-007: Use fallback if structuredClone fails on complex objects
  let remaining: OSNode[];
  try {
    remaining = structuredClone(nodes);
  } catch {
    remaining = deepCopyNodes(nodes);
  }

  // Score each top-level subtree and attach pre-calculated token sizes
  interface Scored {
    node: OSNode;
    score: number;
    originalIndex: number;
    tokenSize: number;
  }

  const scored: Scored[] = remaining.map((node, i) => ({
    node,
    score: scoreSubtree(node),
    originalIndex: i,
    tokenSize: tokenSizeMap.get(node) ?? estimateNodeTokens(node),
  }));

  // Sort by score descending — keep highest priority first
  scored.sort((a, b) => b.score - a.score);

  // Greedily add nodes until budget is exceeded (O(n) instead of O(n²))
  const kept: Scored[] = [];
  let removedCount = 0;
  let currentTokens = 0;

  for (const item of scored) {
    const tentativeSize = currentTokens + item.tokenSize;

    if (Math.ceil(tentativeSize / charsPerToken) <= maxTokens) {
      kept.push(item);
      currentTokens = tentativeSize;
    } else {
      removedCount++;
    }
  }

  // Restore original order
  kept.sort((a, b) => a.originalIndex - b.originalIndex);
  let result = kept.map((s) => s.node);

  if (removedCount > 0) {
    result.push({
      tag: "truncated",
      attributes: { count: String(removedCount) },
      children: [],
    });
  }

  // If still over budget after top-level pruning (e.g. one dominant container),
  // recurse into the largest remaining container's children
  const resultSize = result.reduce((sum, node) => {
    // Use cached size if original node, otherwise estimate
    const size = tokenSizeMap.get(node) ?? estimateNodeTokens(node);
    return sum + size;
  }, 0);
  
  if (Math.ceil(resultSize / charsPerToken) > maxTokens) {
    // Find the container with the most children to prune into
    let largestIdx = -1;
    let largestChildCount = 0;
    for (let i = 0; i < result.length; i++) {
      if (result[i].children.length > largestChildCount) {
        largestChildCount = result[i].children.length;
        largestIdx = i;
      }
    }

    if (largestIdx >= 0 && largestChildCount > 1) {
      result = result.map((node, i) =>
        i === largestIdx ? pruneChildren(node, maxTokens, charsPerToken) : node
      );
    }
  }

  return result;
}
