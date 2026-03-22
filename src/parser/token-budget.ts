import type { OSNode } from "../types.js";
import { serialize } from "./serializer.js";

/**
 * Estimate the number of tokens in a serialized string.
 * Uses a simple heuristic of ~4 characters per token.
 */
export function estimateTokens(xml: string, charsPerToken: number = 4): number {
  return Math.ceil(xml.length / charsPerToken);
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
 */
function pruneChildren(node: OSNode, maxTokens: number, charsPerToken: number): OSNode {
  if (node.children.length === 0) return node;

  interface Scored {
    node: OSNode;
    score: number;
    originalIndex: number;
  }

  const scored: Scored[] = node.children.map((child, i) => ({
    node: child,
    score: scoreSubtree(child),
    originalIndex: i,
  }));

  scored.sort((a, b) => b.score - a.score);

  const kept: Scored[] = [];
  let removedCount = 0;

  for (const item of scored) {
    const tentative = [...kept, item].sort((a, b) => a.originalIndex - b.originalIndex);
    const tentativeNode = { ...node, children: tentative.map((s) => s.node) };
    const tentativeXml = serialize([tentativeNode], 1);

    if (estimateTokens(tentativeXml, charsPerToken) <= maxTokens) {
      kept.push(item);
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
 */
export function pruneToFit(
  nodes: OSNode[],
  options: PruneOptions
): OSNode[] {
  const { maxTokens, charsPerToken = 4 } = options;

  // Check if already under budget
  const xml = serialize(nodes, 1);
  if (estimateTokens(xml, charsPerToken) <= maxTokens) {
    return nodes;
  }

  // Deep clone so we don't mutate input
  const remaining: OSNode[] = structuredClone(nodes);

  // Score each top-level subtree
  interface Scored {
    node: OSNode;
    score: number;
    originalIndex: number;
  }

  const scored: Scored[] = remaining.map((node, i) => ({
    node,
    score: scoreSubtree(node),
    originalIndex: i,
  }));

  // Sort by score descending — keep highest priority first
  scored.sort((a, b) => b.score - a.score);

  // Greedily add nodes until budget is exceeded
  const kept: Scored[] = [];
  let removedCount = 0;

  for (const item of scored) {
    const tentative = [...kept, item].sort((a, b) => a.originalIndex - b.originalIndex);
    const tentativeNodes = tentative.map((s) => s.node);
    const tentativeXml = serialize(tentativeNodes, 1);

    if (estimateTokens(tentativeXml, charsPerToken) <= maxTokens) {
      kept.push(item);
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
  const resultXml = serialize(result, 1);
  if (estimateTokens(resultXml, charsPerToken) > maxTokens) {
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
