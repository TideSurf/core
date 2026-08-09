import type { OSNode } from "../types.js";
import { validatePositiveNumber } from "../validation.js";
import {
  CLOSED_FLAG,
  HEADING_MAP,
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
  escapeUrlMarkers,
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
  /** Characters already committed outside the tree (e.g. the page header). */
  reservedChars?: number;
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

// Real LLM tokenizers emit roughly one token per CJK character versus one
// token per `charsPerToken` Latin characters. Weight CJK code points at
// `charsPerToken` units each so the character budget tracks the real token
// budget on CJK-heavy pages.
const CJK_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x11ff], // Hangul Jamo
  [0x2e80, 0x2eff], // CJK Radicals Supplement
  [0x2f00, 0x2fdf], // Kangxi Radicals
  [0x3000, 0x303f], // CJK Symbols and Punctuation
  [0x3040, 0x309f], // Hiragana
  [0x30a0, 0x30ff], // Katakana
  [0x3100, 0x312f], // Bopomofo
  [0x3130, 0x318f], // Hangul Compatibility Jamo
  [0x31a0, 0x31bf], // Bopomofo Extended
  [0x31f0, 0x31ff], // Katakana Phonetic Extensions
  [0x3400, 0x4dbf], // CJK Unified Extension A
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0xa000, 0xa4cf], // Yi Syllables
  [0xac00, 0xd7af], // Hangul Syllables
  [0xf900, 0xfaff], // CJK Compatibility Ideographs
  [0xff00, 0xffef], // Fullwidth Forms
  [0x20000, 0x2a6df], // CJK Extension B
  [0x2a700, 0x2b73f], // CJK Extension C
  [0x2b740, 0x2b81f], // CJK Extension D
  [0x2b820, 0x2ceaf], // CJK Extension E/F
  [0x2ceb0, 0x2ebef], // CJK Extension G/H
  [0x2f800, 0x2fa1f], // CJK Compatibility Supplement
];

function isCjkCodePoint(codePoint: number): boolean {
  let low = 0;
  let high = CJK_RANGES.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const [start, end] = CJK_RANGES[mid];
    if (codePoint < start) high = mid - 1;
    else if (codePoint > end) low = mid + 1;
    else return true;
  }
  return false;
}

/**
 * Iterate text by code point, invoking `visit` with the code point and its
 * UTF-16 unit length.
 */
function forEachCodePoint(
  text: string,
  visit: (codePoint: number, units: number) => void
): void {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      index + 1 < text.length
    ) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        visit((code - 0xd800) * 0x400 + (next - 0xdc00) + 0x10000, 2);
        index++;
        continue;
      }
    }
    visit(code, 1);
  }
}

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

function escapedQuoteSize(text: string, cjkWeight = 1): number {
  let size = 0;
  forEachCodePoint(text, (codePoint, units) => {
    size += isCjkCodePoint(codePoint) ? cjkWeight : units;
    // Quotes and square brackets are backslash-escaped in attribute output.
    if (codePoint === 34 || codePoint === 91 || codePoint === 93) size++;
  });
  return size;
}

function escapedTextSize(text: string | undefined, cjkWeight = 1): number {
  if (!text) return 0;
  let size = 0;
  forEachCodePoint(text, (codePoint, units) => {
    size += isCjkCodePoint(codePoint) ? cjkWeight : units;
    if (codePoint === 38) size += 4; // & -> &amp;
    else if (codePoint === 60 || codePoint === 62) size += 3; // < >
    else if (codePoint === 34) size += 5; // " -> &quot;
    else if (codePoint === 91 || codePoint === 93) size += 1; // [ ] -> \[ \]
  });
  return size;
}

/** Script-aware size of text emitted verbatim (already escaped upstream). */
function plainTextSize(text: string | undefined, cjkWeight = 1): number {
  if (!text) return 0;
  let size = 0;
  forEachCodePoint(text, (codePoint, units) => {
    size += isCjkCodePoint(codePoint) ? cjkWeight : units;
  });
  return size;
}

/**
 * Weighted length of an already-composed string in budget units. Use this
 * for reserving wrapper text (page header) from a token budget so CJK-heavy
 * headers do not drift the output over budget.
 */
export function weightedTextLength(text: string, cjkWeight = 1): number {
  return plainTextSize(text, cjkWeight);
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
  hasNonInteractiveText = hasText(node.text),
  cjkWeight = 1,
  inheritedDisabled = false
): number {
  const idSize = node.id?.length ?? 0;
  const attributes = node.attributes;
  const indentation = node.tag === "list" ? 0 : depth * 2;

  if (node.tag === "#text") return indentation + escapedTextSize(node.text, cjkWeight) + 1;
  if (node.tag === "truncated") {
    return indentation + TRUNCATION_SIZE_WITHOUT_COUNT +
      String(attributes["count"] ?? "?").length;
  }
  if (node.tag === "link") {
    const href = attributes["href"];
    const hrefSize = href
      ? escapeUrlMarkers(compressUrlWithContext(href, url)).length
      : 0;
    const fallbackSize = hasNonInteractiveText
      ? 0
      : escapedTextSize(attributes["aria-label"] || attributes["title"], cjkWeight);
    const targetSize = href && attributes["target"] === "_blank" ? 2 : 0;
    return indentation + idSize + hrefSize + escapedTextSize(node.text, cjkWeight) +
      fallbackSize + targetSize + stateSize(node) + 8;
  }
  if (node.tag === "button") {
    const fallbackSize = hasNonInteractiveText
      ? 0
      : escapedTextSize(attributes["aria-label"] || attributes["title"], cjkWeight);
    return indentation + idSize + escapedTextSize(node.text, cjkWeight) + fallbackSize +
      stateSize(node) + 5;
  }
  if (node.tag === "input") {
    let size = indentation + idSize + stateSize(node) + 2;
    const type = attributes["type"];
    const placeholder = attributes["placeholder"];
    const value = attributes["value"];
    if (type && type !== "text") size += escapedQuoteSize(type, cjkWeight) + 1;
    if (placeholder) size += escapedQuoteSize(placeholder, cjkWeight) + 2;
    if (value) size += escapedQuoteSize(value, cjkWeight) + 4;
    const min = attributes["min"];
    const max = attributes["max"];
    const step = attributes["step"];
    const pattern = attributes["pattern"];
    if (min !== undefined) size += escapedQuoteSize(min, cjkWeight) + 5;
    if (max !== undefined) size += escapedQuoteSize(max, cjkWeight) + 5;
    if (step !== undefined) size += escapedQuoteSize(step, cjkWeight) + 6;
    if (pattern !== undefined) size += escapedQuoteSize(pattern, cjkWeight) + 9;
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
    return indentation + (alt ? escapedTextSize(alt, cjkWeight) + 8 : 6);
  }
  if (node.tag === "iframe") {
    const src = attributes["src"];
    const srcSize = src
      ? escapeUrlMarkers(compressUrlWithContext(src, url)).length + 14
      : 0;
    const emptySize = attributes["status"] === "inaccessible"
      ? IFRAME_INACCESSIBLE_SIZE
      : IFRAME_UNKNOWN_SIZE;
    return indentation + Math.max(srcSize, emptySize);
  }
  if (HEADING_TAGS.has(node.tag)) {
    // The serializer emits `${prefix} ${content}` plus a newline, so the
    // overhead is the per-tag prefix length + 2 (h4-h6 use "####").
    // Element-node heading text is a synthesized, pre-escaped summary.
    const prefixLength = HEADING_MAP[node.tag]?.length ?? 2;
    return indentation + plainTextSize(node.text, cjkWeight) + prefixLength + 2;
  }
  if (node.tag === "above" || node.tag === "below") {
    // Summary text is pre-escaped at composition time and emitted verbatim.
    return indentation + node.tag.length + plainTextSize(node.text, cjkWeight) + 4;
  }
  if (STRUCTURAL_CONTAINERS.has(node.tag)) {
    const ariaLabel = attributes["aria-label"];
    const summary = node.text?.trim();
    let descriptionSize = 0;
    if (ariaLabel) descriptionSize = escapedTextSize(ariaLabel, cjkWeight) + 2;
    if (summary && summary !== ariaLabel) {
      // Pre-escaped landmark summary, emitted verbatim.
      descriptionSize += plainTextSize(summary, cjkWeight) + (descriptionSize > 0 ? 3 : 2);
    }
    return indentation + node.tag.length + (idSize > 0 ? idSize + 1 : 0) +
      descriptionSize + 1;
  }
  if (node.tag === "optgroup") {
    const label = attributes["aria-label"] || attributes["label"];
    const disabled = inheritedDisabled ||
      attributes["disabled"] !== undefined ||
      attributes["aria-disabled"] === "true";
    // The serializer strikes disabled optgroup labels (~~label~~, +4).
    return indentation + (label ? escapedTextSize(label, cjkWeight) + (disabled ? 4 : 0) + 2 : 0) +
      escapedTextSize(node.text, cjkWeight);
  }
  if (node.tag === "item") {
    return indentation + escapedTextSize(node.text, cjkWeight) +
      (node.id ? idSize + 3 : 0) + 4;
  }
  if (node.tag === "option") {
    const selected = attributes["selected"] !== undefined ||
      attributes["aria-selected"] === "true";
    const disabled = inheritedDisabled ||
      attributes["disabled"] !== undefined ||
      attributes["aria-disabled"] === "true";
    // The serializer strikes disabled options (~~text~~, +4), including
    // disabled inherited from an optgroup.
    return indentation + escapedTextSize(node.text, cjkWeight) +
      (selected ? 2 : 0) + (disabled ? 4 : 0) + 4;
  }
  if (
    node.tag === "list" ||
    node.tag === "row" ||
    node.tag === "cell" ||
    node.tag === "label"
  ) {
    return indentation + escapedTextSize(node.text, cjkWeight) + 4;
  }
  return indentation + escapedTextSize(node.text, cjkWeight) + 1;
}

function childDepth(node: OSNode, depth: number): number {
  return STRUCTURAL_CONTAINERS.has(node.tag) ||
    node.tag === "iframe" ||
    node.tag === "select" ||
    node.tag === "optgroup" ||
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
  cacheDescendants = false,
  cjkWeight = 1,
  inheritedDisabled = false
): NodeMetrics {
  let totalSize = 0;
  let interactiveCount = node.id ? 1 : 0;
  let visibleCount = node.visible ? 1 : 0;
  let textLength = node.text?.length ?? 0;
  let hasNonInteractiveText = node.tag === "truncated" || hasText(node.text);

  const nextDepth = childDepth(node, depth);
  const cacheChildren = cacheDescendants || node.children.length > 1;
  // The serializer threads disabled from select/optgroup to their option
  // descendants; mirror that here so the strike markers are accounted for.
  const childInheritedDisabled = inheritedDisabled ||
    ((node.tag === "select" || node.tag === "optgroup") &&
      (node.attributes["disabled"] !== undefined ||
        node.attributes["aria-disabled"] === "true"));
  for (const child of node.children) {
    const childMetrics = measureNode(
      child,
      nextDepth,
      url,
      metrics,
      cacheChildren,
      cacheDescendants,
      cjkWeight,
      childInheritedDisabled
    );
    totalSize += childMetrics.totalSize;
    interactiveCount += childMetrics.interactiveCount;
    visibleCount += childMetrics.visibleCount;
    textLength += childMetrics.textLength;
    if (!child.id && childMetrics.hasNonInteractiveText) {
      hasNonInteractiveText = true;
    }
  }

  const ownSize = estimateOwnSize(
    node,
    depth,
    url,
    hasNonInteractiveText,
    cjkWeight,
    inheritedDisabled
  );
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
  url: UrlCompressionContext,
  cjkWeight = 1
): Map<OSNode, NodeMetrics> {
  const metrics = new Map<OSNode, NodeMetrics>();
  for (const node of nodes) {
    measureNode(node, 0, url, metrics, true, false, cjkWeight);
  }
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
  url: UrlCompressionContext,
  cjkWeight = 1
): FittedNode | undefined {
  const usefulShell = withoutFallbackLabels({
    ...node,
    children: [],
    text: undefined,
  });
  const usefulShellSize = estimateOwnSize(usefulShell, depth, url, false, cjkWeight);
  if (usefulShellSize <= budget) {
    return {
      node: usefulShell,
      size: usefulShellSize,
      hasNonInteractiveText: false,
    };
  }

  const bareShell = { ...node, attributes: {}, children: [], text: undefined };
  const bareShellSize = estimateOwnSize(bareShell, depth, url, false, cjkWeight);
  return bareShellSize <= budget
    ? { node: bareShell, size: bareShellSize, hasNonInteractiveText: false }
    : undefined;
}

function fitNode(
  node: OSNode,
  budget: number,
  metrics: Map<OSNode, NodeMetrics>,
  depth: number,
  url: UrlCompressionContext,
  cjkWeight = 1
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
    const weightedSize = (value: string | undefined) =>
      escapedTextSize(value, cjkWeight);
    const minimumSize = depth * 2 + escapedTextSize("...", cjkWeight) + 1;
    if (budget < minimumSize) return undefined;
    const shortened = truncateGraphemes(text, budget, {
      suffix: "...",
      measure: weightedSize,
      reservedSize: minimumSize,
    });
    const shortenedNode = { ...node, text: shortened };
    return {
      node: shortenedNode,
      size: estimateOwnSize(shortenedNode, depth, url, true, cjkWeight),
      hasNonInteractiveText: Boolean(shortened.trim()),
    };
  }
  if (node.children.length === 0) {
    if (node.id) return fitInteractiveShell(node, budget, depth, url, cjkWeight);
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
    ownSize = estimateOwnSize(base, depth, url, false, cjkWeight);
    if (ownSize > budget) {
      base = { ...node, attributes: {}, children: [], text: undefined };
      ownSize = estimateOwnSize(base, depth, url, false, cjkWeight);
      if (ownSize > budget) return undefined;
    }
  }

  const childResult = fitList(
    node.children,
    budget - ownSize,
    metrics,
    childDepth(node, depth),
    url,
    cjkWeight
  );
  if (childResult.nodes.length === 0) {
    return node.id ? fitInteractiveShell(node, budget, depth, url, cjkWeight) : undefined;
  }

  const hasNonInteractiveText = hasText(base.text) ||
    childResult.collectibleText;
  let fittedNode = { ...base, children: childResult.nodes };
  ownSize = estimateOwnSize(
    fittedNode,
    depth,
    url,
    hasNonInteractiveText,
    cjkWeight
  );

  if (ownSize + childResult.size > budget && !hasNonInteractiveText) {
    fittedNode = withoutFallbackLabels(fittedNode);
    ownSize = estimateOwnSize(fittedNode, depth, url, false, cjkWeight);
  }

  return ownSize + childResult.size <= budget
    ? {
        node: fittedNode,
        size: ownSize + childResult.size,
        hasNonInteractiveText,
      }
    : node.id
      ? fitInteractiveShell(node, budget, depth, url, cjkWeight)
      : undefined;
}

function fitList(
  nodes: OSNode[],
  budget: number,
  metrics: Map<OSNode, NodeMetrics>,
  depth: number,
  url: UrlCompressionContext,
  cjkWeight = 1
): FittedList {
  let totalSize = 0;
  let collectibleText = false;
  for (const node of nodes) {
    const measured = metrics.get(node) ??
      measureNode(node, depth, url, metrics, true, true, cjkWeight);
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
  const markerSize = estimateOwnSize(largestMarker, depth, url, true, cjkWeight);
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
      fitted = fitNode(candidate.node, remaining, metrics, depth, url, cjkWeight);
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
  const { maxTokens, charsPerToken = 4, pageUrl, reservedChars = 0 } = options;
  validatePositiveNumber(maxTokens, "maxTokens");
  validatePositiveNumber(charsPerToken, "charsPerToken");
  const url = createUrlCompressionContext(pageUrl);
  const metrics = measureTree(nodes, url, charsPerToken);
  // CJK code points are weighted at charsPerToken units each, so the
  // character budget tracks the real tokenizer budget on CJK-heavy pages.
  const charBudget = Math.max(0, maxTokens * charsPerToken - reservedChars);
  return fitList(nodes, charBudget, metrics, 0, url, charsPerToken).nodes;
}
