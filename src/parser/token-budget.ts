import type { OSNode } from "../types.js";
import { serializeToXml } from "./xml-serializer.js";

/**
 * Estimate the number of tokens in an XML string.
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
 * Prune a list of OSNodes to fit within a token budget.
 * Removes lowest-priority top-level subtrees first.
 * Returns a new array (does not mutate input).
 */
export function pruneToFit(
  nodes: OSNode[],
  options: PruneOptions
): OSNode[] {
  const { maxTokens, charsPerToken = 4 } = options;

  // Check if already under budget
  const xml = serializeToXml(nodes, 1);
  if (estimateTokens(xml, charsPerToken) <= maxTokens) {
    return nodes;
  }

  // Deep clone so we don't mutate input
  let remaining: OSNode[] = structuredClone(nodes);

  // Score each top-level subtree
  interface Scored {
    node: OSNode;
    score: number;
    originalIndex: number;
  }

  let scored: Scored[] = remaining.map((node, i) => ({
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
    const tentativeXml = serializeToXml(tentativeNodes, 1);

    if (estimateTokens(tentativeXml, charsPerToken) <= maxTokens) {
      kept.push(item);
    } else {
      removedCount++;
    }
  }

  // Restore original order
  kept.sort((a, b) => a.originalIndex - b.originalIndex);
  const result = kept.map((s) => s.node);

  if (removedCount > 0) {
    result.push({
      tag: "truncated",
      attributes: { count: String(removedCount) },
      children: [],
    });
  }

  return result;
}
