import type { OSNode } from "../types.js";

interface DeduplicateOptions {
  minGroupSize?: number;
  showCount?: number;
}

/**
 * Compute a structural shape hash for a node, ignoring content-specific attributes.
 */
function shapeHash(node: OSNode): string {
  const contentKeys = new Set(["id", "value", "placeholder", "href", "src", "alt"]);
  const attrKeys = Object.keys(node.attributes)
    .filter((k) => !contentKeys.has(k))
    .sort()
    .join(",");
  const childShapes = node.children.map(shapeHash).join("|");
  return `${node.tag}[${attrKeys}]{${childShapes}}`;
}

/**
 * Collect ID ranges from a list of nodes for summary text.
 */
function collectIdRanges(nodes: OSNode[]): string {
  const ids: string[] = [];

  function walk(n: OSNode): void {
    if (n.id) ids.push(n.id);
    for (const child of n.children) walk(child);
  }

  for (const n of nodes) walk(n);
  if (ids.length === 0) return "";

  // Group by prefix
  const groups: Map<string, number[]> = new Map();
  for (const id of ids) {
    const prefix = id.replace(/\d+$/, "");
    const num = parseInt(id.slice(prefix.length), 10);
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix)!.push(num);
  }

  const parts: string[] = [];
  for (const [prefix, nums] of groups) {
    nums.sort((a, b) => a - b);
    if (nums.length === 1) {
      parts.push(`${prefix}${nums[0]}`);
    } else {
      parts.push(`${prefix}${nums[0]}-${prefix}${nums[nums.length - 1]}`);
    }
  }

  return parts.join(", ");
}

/**
 * Deduplicate consecutive siblings with identical structural shapes.
 * Keeps the first `showCount` items and replaces the rest with a summary.
 */
export function deduplicateSiblings(
  nodes: OSNode[],
  options?: DeduplicateOptions
): OSNode[] {
  const minGroupSize = options?.minGroupSize ?? 4;
  const showCount = options?.showCount ?? 3;

  const result: OSNode[] = [];
  let i = 0;

  while (i < nodes.length) {
    const currentHash = nodes[i].tag === "#text" ? null : shapeHash(nodes[i]);

    if (currentHash === null) {
      result.push(nodes[i]);
      i++;
      continue;
    }

    // Find run of consecutive siblings with same shape
    let runEnd = i + 1;
    while (runEnd < nodes.length && nodes[runEnd].tag !== "#text" && shapeHash(nodes[runEnd]) === currentHash) {
      runEnd++;
    }

    const runLength = runEnd - i;

    if (runLength >= minGroupSize) {
      // Keep first showCount, summarize rest
      const kept = nodes.slice(i, i + showCount);
      // Recurse into kept nodes
      for (const k of kept) {
        result.push({
          ...k,
          children: deduplicateSiblings(k.children, options),
        });
      }

      const omitted = nodes.slice(i + showCount, runEnd);
      const omittedCount = omitted.length;
      const ranges = collectIdRanges(omitted);
      const summaryText = ranges
        ? `...${omittedCount} more (${ranges})`
        : `...${omittedCount} more`;

      // Inherit visibility if any omitted node was visible
      const anyVisible = omitted.some((n) => n.visible) || kept.some((n) => n.visible);

      result.push({
        tag: "#text",
        attributes: {},
        children: [],
        text: summaryText,
        visible: anyVisible ? true : undefined,
      });

      i = runEnd;
    } else {
      // Recurse into each node's children
      for (let j = i; j < runEnd; j++) {
        result.push({
          ...nodes[j],
          children: deduplicateSiblings(nodes[j].children, options),
        });
      }
      i = runEnd;
    }
  }

  return result;
}
