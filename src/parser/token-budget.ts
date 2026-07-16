import type { OSNode } from "../types.js";
import { validatePositiveNumber } from "../validation.js";
import {
  CLOSED_FLAG,
  IFRAME_INACCESSIBLE_PLACEHOLDER,
  IFRAME_UNKNOWN_PLACEHOLDER,
  OBSCURED_FLAG,
  OPEN_FLAG,
  STRUCTURAL_CONTAINERS,
} from "./serializer.js";
import { formatTruncation, truncateGraphemes } from "./truncation.js";
import {
  compressUrlWithContext,
  createUrlCompressionContext,
  type UrlCompressionContext,
} from "./url-compressor.js";

export function estimateTokens(text: string, charsPerToken: number = 4): number {
  validatePositiveNumber(charsPerToken, "charsPerToken");
  return Math.ceil(text.length / charsPerToken);
}

interface PruneOptions {
  maxTokens: number;
  charsPerToken?: number;
  pageUrl?: string;
}

interface NodeMetrics {
  ownSize: number;
  totalSize: number;
  interactiveCount: number;
  visibleCount: number;
  textLength: number;
  hasNonInteractiveText: boolean;
}

interface FittedNode {
  node: OSNode;
  size: number;
  hasNonInteractiveText: boolean;
}

interface FittedList {
  nodes: OSNode[];
  size: number;
  collectibleText: boolean;
}

interface Candidate {
  node: OSNode;
  index: number;
  metrics: NodeMetrics;
}

const HEADING_TAGS = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "heading",
]);
const TRUNCATION_SIZE_WITHOUT_COUNT = formatTruncation("").length + 1;
const IFRAME_INACCESSIBLE_SIZE = IFRAME_INACCESSIBLE_PLACEHOLDER.length + 1;
const IFRAME_UNKNOWN_SIZE = IFRAME_UNKNOWN_PLACEHOLDER.length + 1;

function stateSize(node: OSNode): number {
  let size = 0;
  const struck =
    node.attributes["disabled"] !== undefined ||
    node.attributes["aria-disabled"] === "true" ||
    node.state?.includes("disabled") ||
    node.state?.includes("inert");
  if (struck) size += 4;
  else if (node.state?.includes("obscured")) size += OBSCURED_FLAG.length;
  if (node.attributes["aria-expanded"] === "true") size += OPEN_FLAG.length;
  else if (node.attributes["aria-expanded"] === "false") {
    size += CLOSED_FLAG.length;
  }
  return size;
}

function escapedQuoteSize(text: string): number {
  let size = text.length;
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) === 34) size++;
  }
  return size;
}

function escapedTextSize(text: string | undefined): number {
  if (!text) return 0;
  let size = text.length;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code === 38) size += 4;
    else if (code === 60 || code === 62) size += 3;
    else if (code === 34) size += 5;
  }
  return size;
}

function hasText(text: string | undefined): boolean {
  if (!text) return false;
  // Match String.trim whitespace while keeping already-trimmed parser text fast.
  const first = text.charCodeAt(0);
  const startsWithWhitespace =
    (first >= 0x09 && first <= 0x0d) ||
    first === 0x20 ||
    first === 0xa0 ||
    first === 0x1680 ||
    (first >= 0x2000 && first <= 0x200a) ||
    first === 0x2028 ||
    first === 0x2029 ||
    first === 0x202f ||
    first === 0x205f ||
    first === 0x3000 ||
    first === 0xfeff;
  return !startsWithWhitespace || text.trim().length > 0;
}

/** Estimate only the characters contributed by this node, excluding children. */
function estimateOwnSize(
  node: OSNode,
  depth: number,
  url: UrlCompressionContext,
  hasNonInteractiveText = hasText(node.text)
): number {
  const idSize = node.id?.length ?? 0;
  const attributes = node.attributes;
  const indentation = node.tag === "list" ? 0 : depth * 2;

  if (node.tag === "#text") return indentation + escapedTextSize(node.text) + 1;
  if (node.tag === "truncated") {
    return indentation + TRUNCATION_SIZE_WITHOUT_COUNT +
      String(attributes["count"] ?? "?").length;
  }
  if (node.tag === "link") {
    const href = attributes["href"];
    const hrefSize = href
      ? compressUrlWithContext(href, url).length
      : 0;
    const fallbackSize = hasNonInteractiveText
      ? 0
      : escapedTextSize(attributes["aria-label"] || attributes["title"]);
    const targetSize = href && attributes["target"] === "_blank" ? 2 : 0;
    return indentation + idSize + hrefSize + escapedTextSize(node.text) +
      fallbackSize + targetSize + stateSize(node) + 8;
  }
  if (node.tag === "button") {
    const fallbackSize = hasNonInteractiveText
      ? 0
      : escapedTextSize(attributes["aria-label"] || attributes["title"]);
    return indentation + idSize + escapedTextSize(node.text) + fallbackSize +
      stateSize(node) + 5;
  }
  if (node.tag === "input") {
    let size = indentation + idSize + stateSize(node) + 2;
    const type = attributes["type"];
    const placeholder = attributes["placeholder"];
    const value = attributes["value"];
    if (type && type !== "text") size += type.length + 1;
    if (placeholder) size += escapedQuoteSize(placeholder) + 2;
    if (value) size += escapedQuoteSize(value) + 4;
    const min = attributes["min"];
    const max = attributes["max"];
    const step = attributes["step"];
    const pattern = attributes["pattern"];
    if (min !== undefined) size += min.length + 5;
    if (max !== undefined) size += max.length + 5;
    if (step !== undefined) size += step.length + 6;
    if (pattern !== undefined) size += pattern.length + 9;
    if (attributes["readonly"] !== undefined) size += 9;
    if (attributes["required"] !== undefined) size += 9;
    if (attributes["checked"] !== undefined) size += 8;
    return size;
  }
  if (node.tag === "select") {
    return indentation + idSize + stateSize(node) + 10 +
      (attributes["required"] !== undefined ? 9 : 0) +
      (attributes["multiple"] !== undefined ? 9 : 0);
  }
  if (node.tag === "img") {
    const alt = attributes["alt"];
    return indentation + (alt ? alt.length + 8 : 6);
  }
  if (node.tag === "iframe") {
    const src = attributes["src"];
    const srcSize = src
      ? compressUrlWithContext(src, url).length + 14
      : 0;
    const emptySize = attributes["status"] === "inaccessible"
      ? IFRAME_INACCESSIBLE_SIZE
      : IFRAME_UNKNOWN_SIZE;
    return indentation + Math.max(srcSize, emptySize);
  }
  if (HEADING_TAGS.has(node.tag)) {
    return indentation + escapedTextSize(node.text) + 5;
  }
  if (node.tag === "above" || node.tag === "below") {
    return indentation + node.tag.length + (node.text?.length ?? 0) + 4;
  }
  if (STRUCTURAL_CONTAINERS.has(node.tag)) {
    const ariaLabel = attributes["aria-label"];
    const summary = node.text?.trim();
    let descriptionSize = 0;
    if (ariaLabel) descriptionSize = escapedTextSize(ariaLabel) + 2;
    if (summary && summary !== ariaLabel) {
      descriptionSize += escapedTextSize(summary) + (descriptionSize > 0 ? 3 : 2);
    }
    return indentation + node.tag.length + (idSize > 0 ? idSize + 1 : 0) +
      descriptionSize + 1;
  }
  if (node.tag === "optgroup") {
    const label = attributes["aria-label"] || attributes["label"];
    return indentation + (label ? label.length + 2 : 0) +
      escapedTextSize(node.text);
  }
  if (node.tag === "item") {
    return indentation + escapedTextSize(node.text) +
      (node.id ? idSize + 3 : 0) + 4;
  }
  if (node.tag === "option") {
    const selected = attributes["selected"] !== undefined ||
      attributes["aria-selected"] === "true";
    return indentation + escapedTextSize(node.text) + (selected ? 2 : 0) + 4;
  }
  if (
    node.tag === "list" ||
    node.tag === "row" ||
    node.tag === "cell" ||
    node.tag === "label"
  ) {
    return indentation + (node.text?.length ?? 0) + 4;
  }
  return indentation + escapedTextSize(node.text) + 1;
}

function childDepth(node: OSNode, depth: number): number {
  return STRUCTURAL_CONTAINERS.has(node.tag) ||
    node.tag === "iframe" ||
    node.tag === "select" ||
    node.tag === "row" ||
    node.tag === "cell" ||
    node.tag === "label" ||
    node.tag === "link" ||
    node.tag === "button"
    ? depth + 1
    : depth;
}

function measureNode(
  node: OSNode,
  depth: number,
  url: UrlCompressionContext,
  metrics: Map<OSNode, NodeMetrics>,
  cache: boolean,
  cacheDescendants = false
): NodeMetrics {
  let totalSize = 0;
  let interactiveCount = node.id ? 1 : 0;
  let visibleCount = node.visible ? 1 : 0;
  let textLength = node.text?.length ?? 0;
  let hasNonInteractiveText = node.tag === "truncated" || hasText(node.text);

  const nextDepth = childDepth(node, depth);
  const cacheChildren = cacheDescendants || node.children.length > 1;
  for (const child of node.children) {
    const childMetrics = measureNode(
      child,
      nextDepth,
      url,
      metrics,
      cacheChildren,
      cacheDescendants
    );
    totalSize += childMetrics.totalSize;
    interactiveCount += childMetrics.interactiveCount;
    visibleCount += childMetrics.visibleCount;
    textLength += childMetrics.textLength;
    if (!child.id && childMetrics.hasNonInteractiveText) {
      hasNonInteractiveText = true;
    }
  }

  const ownSize = estimateOwnSize(node, depth, url, hasNonInteractiveText);
  totalSize += ownSize;
  const result = {
    ownSize,
    totalSize,
    interactiveCount,
    visibleCount,
    textLength,
    hasNonInteractiveText,
  };
  if (cache) metrics.set(node, result);
  return result;
}

function measureTree(
  nodes: OSNode[],
  url: UrlCompressionContext
): Map<OSNode, NodeMetrics> {
  const metrics = new Map<OSNode, NodeMetrics>();
  for (const node of nodes) measureNode(node, 0, url, metrics, true);
  return metrics;
}

function comparePriority(
  left: Candidate,
  right: Candidate
): number {
  const a = left.metrics;
  const b = right.metrics;
  const aInteractive = a.interactiveCount > 0 ? 1 : 0;
  const bInteractive = b.interactiveCount > 0 ? 1 : 0;
  if (aInteractive !== bInteractive) return bInteractive - aInteractive;

  const aVisible = a.visibleCount > 0 ? 1 : 0;
  const bVisible = b.visibleCount > 0 ? 1 : 0;
  if (aVisible !== bVisible) return bVisible - aVisible;
  if (a.interactiveCount !== b.interactiveCount) {
    return b.interactiveCount - a.interactiveCount;
  }
  if (a.visibleCount !== b.visibleCount) return b.visibleCount - a.visibleCount;
  if (a.textLength !== b.textLength) return a.textLength - b.textLength;
  return 0;
}

function truncationNode(count: number): OSNode {
  return {
    tag: "truncated",
    attributes: { count: String(count) },
    children: [],
  };
}

function withoutFallbackLabels(node: OSNode): OSNode {
  if (node.tag !== "link" && node.tag !== "button") return node;
  const attributes = { ...node.attributes };
  delete attributes["aria-label"];
  delete attributes["title"];
  return { ...node, attributes };
}

function fitInteractiveShell(
  node: OSNode,
  budget: number,
  depth: number,
  url: UrlCompressionContext
): FittedNode | undefined {
  const usefulShell = withoutFallbackLabels({
    ...node,
    children: [],
    text: undefined,
  });
  const usefulShellSize = estimateOwnSize(usefulShell, depth, url, false);
  if (usefulShellSize <= budget) {
    return {
      node: usefulShell,
      size: usefulShellSize,
      hasNonInteractiveText: false,
    };
  }

  const bareShell = { ...node, attributes: {}, children: [], text: undefined };
  const bareShellSize = estimateOwnSize(bareShell, depth, url, false);
  return bareShellSize <= budget
    ? { node: bareShell, size: bareShellSize, hasNonInteractiveText: false }
    : undefined;
}

function fitNode(
  node: OSNode,
  budget: number,
  metrics: Map<OSNode, NodeMetrics>,
  depth: number,
  url: UrlCompressionContext
): FittedNode | undefined {
  const measured = metrics.get(node)!;
  if (measured.totalSize <= budget) {
    return {
      node,
      size: measured.totalSize,
      hasNonInteractiveText: measured.hasNonInteractiveText,
    };
  }
  if (node.tag === "#text") {
    const text = node.text ?? "";
    const minimumSize = depth * 2 + escapedTextSize("...") + 1;
    if (budget < minimumSize) return undefined;
    const shortened = truncateGraphemes(text, budget, {
      suffix: "...",
      measure: escapedTextSize,
      reservedSize: minimumSize,
    });
    const shortenedNode = { ...node, text: shortened };
    return {
      node: shortenedNode,
      size: estimateOwnSize(shortenedNode, depth, url, true),
      hasNonInteractiveText: Boolean(shortened.trim()),
    };
  }
  if (node.children.length === 0) {
    if (node.id) return fitInteractiveShell(node, budget, depth, url);
    return undefined;
  }

  let base = node;
  let ownSize = measured.ownSize;
  if (ownSize > budget) {
    base = withoutFallbackLabels({
      ...node,
      children: [],
      text: undefined,
    });
    ownSize = estimateOwnSize(base, depth, url, false);
    if (ownSize > budget) {
      base = { ...node, attributes: {}, children: [], text: undefined };
      ownSize = estimateOwnSize(base, depth, url, false);
      if (ownSize > budget) return undefined;
    }
  }

  const childResult = fitList(
    node.children,
    budget - ownSize,
    metrics,
    childDepth(node, depth),
    url
  );
  if (childResult.nodes.length === 0) {
    return node.id ? fitInteractiveShell(node, budget, depth, url) : undefined;
  }

  const hasNonInteractiveText = hasText(base.text) ||
    childResult.collectibleText;
  let fittedNode = { ...base, children: childResult.nodes };
  ownSize = estimateOwnSize(
    fittedNode,
    depth,
    url,
    hasNonInteractiveText
  );

  if (ownSize + childResult.size > budget && !hasNonInteractiveText) {
    fittedNode = withoutFallbackLabels(fittedNode);
    ownSize = estimateOwnSize(fittedNode, depth, url, false);
  }

  return ownSize + childResult.size <= budget
    ? {
        node: fittedNode,
        size: ownSize + childResult.size,
        hasNonInteractiveText,
      }
    : node.id
      ? fitInteractiveShell(node, budget, depth, url)
      : undefined;
}

function fitList(
  nodes: OSNode[],
  budget: number,
  metrics: Map<OSNode, NodeMetrics>,
  depth: number,
  url: UrlCompressionContext
): FittedList {
  let totalSize = 0;
  let collectibleText = false;
  for (const node of nodes) {
    const measured = metrics.get(node) ??
      measureNode(node, depth, url, metrics, true, true);
    totalSize += measured.totalSize;
    if (!node.id && measured.hasNonInteractiveText) collectibleText = true;
  }
  if (totalSize <= budget) {
    return {
      nodes,
      size: totalSize,
      collectibleText,
    };
  }

  const largestMarker = truncationNode(nodes.length);
  const markerSize = estimateOwnSize(largestMarker, depth, url, true);
  const contentBudget = Math.max(0, budget - markerSize);
  const candidates = new Array<Candidate>(nodes.length);
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    candidates[index] = { node, index, metrics: metrics.get(node)! };
  }
  candidates.sort(comparePriority);
  const kept = new Array<FittedNode | undefined>(nodes.length);
  let usedSize = 0;
  let removedCount = 0;

  for (const candidate of candidates) {
    const remaining = contentBudget - usedSize;
    const measured = candidate.metrics;
    let fitted: FittedNode | undefined;

    if (measured.totalSize <= remaining) {
      fitted = {
        node: candidate.node,
        size: measured.totalSize,
        hasNonInteractiveText: measured.hasNonInteractiveText,
      };
    } else if (remaining > 0) {
      fitted = fitNode(candidate.node, remaining, metrics, depth, url);
    }

    if (fitted) {
      kept[candidate.index] = fitted;
      usedSize += fitted.size;
    } else {
      removedCount++;
    }
  }

  const result: OSNode[] = [];
  collectibleText = false;
  for (const fitted of kept) {
    if (!fitted) continue;
    result.push(fitted.node);
    if (!fitted.node.id && fitted.hasNonInteractiveText) collectibleText = true;
  }
  let markerAdded = false;
  if (removedCount > 0 && markerSize <= budget - usedSize) {
    result.push(truncationNode(removedCount));
    usedSize += markerSize;
    markerAdded = true;
  }
  return {
    nodes: result,
    size: usedSize,
    collectibleText: collectibleText || markerAdded,
  };
}

/**
 * Fit a tree to a token budget without mutating it. Unchanged subtrees retain
 * their identity; only containers whose children are pruned are copied.
 */
export function pruneToFit(nodes: OSNode[], options: PruneOptions): OSNode[] {
  const { maxTokens, charsPerToken = 4, pageUrl } = options;
  validatePositiveNumber(maxTokens, "maxTokens");
  validatePositiveNumber(charsPerToken, "charsPerToken");
  const url = createUrlCompressionContext(pageUrl);
  const metrics = measureTree(nodes, url);
  return fitList(nodes, maxTokens * charsPerToken, metrics, 0, url).nodes;
}
