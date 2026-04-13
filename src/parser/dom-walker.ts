import type { CDPNode, OSNode, NodeMap } from "../types.js";
import { classify, parseAttributes } from "./element-classifier.js";
import { IDAssigner } from "./id-assigner.js";

const KNOWN_STATE_FLAGS = new Set(["disabled", "inert", "obscured"]);

/**
 * Attributes worth preserving in output
 */
const PASS_THROUGH_ATTRS = new Set([
  "href",
  "src",
  "alt",
  "title",
  "placeholder",
  "value",
  "type",
  "method",
  "target",
  "disabled",
  "checked",
  "selected",
  "readonly",
  "required",
  "multiple",
  "min",
  "max",
  "step",
  "pattern",
  "for",
  "aria-label",
  "aria-expanded",
  "aria-selected",
  "aria-checked",
  "aria-disabled",
  "label",
]);

export interface WalkResult {
  nodes: OSNode[];
  nodeMap: NodeMap;
}

interface WalkContext {
  insideInteractive: boolean;
  insideHeading: boolean;
}

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "heading"]);
const TEXT_TRUNCATE_LIMIT = 60;

// MED-004: Use Intl.Segmenter for grapheme-aware truncation if available
const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl
  ? new Intl.Segmenter("en", { granularity: "grapheme" })
  : null;

function getGraphemeCount(text: string): number {
  if (segmenter) {
    return Array.from(segmenter.segment(text)).length;
  }
  // Fallback: use code unit length (less accurate for complex scripts)
  return text.length;
}

function truncateGraphemes(text: string, limit: number): string {
  if (getGraphemeCount(text) <= limit) return text;

  if (segmenter) {
    const segments = Array.from(segmenter.segment(text));
    // Find a good break point near the limit
    let end = limit;
    while (end > 0 && segments[end] && !/\s/.test(segments[end].segment)) {
      end--;
    }
    if (end <= 0) end = limit;
    return segments.slice(0, end).map(s => s.segment).join("").trimEnd() + "...";
  }

  // Fallback: use code unit-based truncation
  const cut = text.lastIndexOf(" ", limit);
  const end = cut > 0 ? cut : limit;
  return text.slice(0, end) + "...";
}

/**
 * Walk a CDP DOM tree and produce compressed OSNode tree + nodeMap.
 * @param truncate - Set false to disable text truncation (e.g. for search)
 */
const MAX_DEPTH = 500;

export function walkDOM(root: CDPNode, options?: { truncate?: boolean }): WalkResult {
  const assigner = new IDAssigner();
  const nodeMap: NodeMap = new Map();
  const doTruncate = options?.truncate !== false;
  const ctx: WalkContext = { insideInteractive: false, insideHeading: false };

  const nodes = walkChildren(root.children ?? [], assigner, nodeMap, ctx, doTruncate, 0);
  const cleaned = postProcess(nodes);

  return { nodes: cleaned, nodeMap };
}

function walkNode(
  node: CDPNode,
  assigner: IDAssigner,
  nodeMap: NodeMap,
  ctx: WalkContext,
  doTruncate: boolean,
  depth: number = 0
): OSNode[] {
  // Prevent stack overflow on deeply nested DOM
  if (depth > MAX_DEPTH) {
    return [{ tag: "#text", text: "[truncated]", attributes: {}, children: [] }];
  }

  // Text nodes
  if (node.nodeType === 3) {
    let text = (node.nodeValue ?? "").trim();
    if (!text) return [];
    if (doTruncate && !ctx.insideInteractive && !ctx.insideHeading) {
      text = truncateGraphemes(text, TEXT_TRUNCATE_LIMIT);
    }
    return [{ tag: "#text", attributes: {}, children: [], text }];
  }

  // Only process element nodes
  if (node.nodeType !== 1) return [];

  const attrs = parseAttributes(node.attributes);
  const children = node.children ?? [];

  const result = classify(
    node.nodeName,
    attrs,
    children.map((c) => ({ nodeName: c.nodeName, attributes: c.attributes }))
  );

  if (result.action === "DISCARD") return [];

  if (result.action === "COLLAPSE") {
    // Promote children
    const promoted = walkChildren(children, assigner, nodeMap, ctx, doTruncate, depth + 1);
    // Also walk shadow roots if present
    if (node.shadowRoots) {
      for (const shadowRoot of node.shadowRoots) {
        promoted.push(
          ...walkChildren(shadowRoot.children ?? [], assigner, nodeMap, ctx, doTruncate, depth + 1)
        );
      }
    }
    return promoted;
  }

  // KEEP
  const tag = result.mappedTag!;

  // Special handling for IFRAME
  if (tag === "iframe") {
    const visible = attrs["data-os-visible"] === "1" ? true : undefined;
    const stateAttr = attrs["data-os-state"];
    const rawState = stateAttr ? stateAttr.split(",").filter(f => KNOWN_STATE_FLAGS.has(f)) : undefined;
    const state = rawState && rawState.length > 0 ? rawState : undefined;
    const filteredAttrs: Record<string, string> = {};
    for (const key of PASS_THROUGH_ATTRS) {
      if (attrs[key] !== undefined) {
        filteredAttrs[key] = attrs[key];
      }
    }

    if (node.contentDocument) {
      // Same-origin iframe — walk into its content
      const iframeChildren = walkChildren(
        node.contentDocument.children ?? [],
        assigner,
        nodeMap,
        ctx,
        doTruncate,
        depth + 1
      );
      return [
        {
          tag: "iframe",
          attributes: filteredAttrs,
          children: postProcess(iframeChildren),
          visible,
          state,
        },
      ];
    } else {
      // Cross-origin iframe — emit inaccessible marker
      return [
        {
          tag: "iframe",
          attributes: { ...filteredAttrs, status: "inaccessible" },
          children: [],
          visible,
          state,
        },
      ];
    }
  }

  const id = assigner.assign(tag);

  if (id) {
    nodeMap.set(id, node.backendNodeId);
  }

  // Build filtered attributes
  const filteredAttrs: Record<string, string> = {};
  if (id) filteredAttrs["id"] = id;

  for (const key of PASS_THROUGH_ATTRS) {
    if (attrs[key] !== undefined) {
      filteredAttrs[key] = attrs[key];
    }
  }

  // Elide default/redundant attributes
  if (tag === "input" && filteredAttrs["type"] === "text") {
    delete filteredAttrs["type"];
  }
  if (tag === "form" && filteredAttrs["method"]?.toLowerCase() === "get") {
    delete filteredAttrs["method"];
  }
  if (
    filteredAttrs["aria-label"] &&
    filteredAttrs["placeholder"] &&
    filteredAttrs["aria-label"] === filteredAttrs["placeholder"]
  ) {
    delete filteredAttrs["aria-label"];
  }

  // Build child context
  const childCtx: WalkContext = {
    insideInteractive: ctx.insideInteractive || !!id,
    insideHeading: ctx.insideHeading || HEADING_TAGS.has(tag),
  };

  // Walk regular children
  const osChildren = walkChildren(children, assigner, nodeMap, childCtx, doTruncate, depth + 1);

  // Walk shadow roots and merge shadow children into host's children
  if (node.shadowRoots) {
    for (const shadowRoot of node.shadowRoots) {
      osChildren.push(
        ...walkChildren(shadowRoot.children ?? [], assigner, nodeMap, childCtx, doTruncate, depth + 1)
      );
    }
  }

  // Check for visibility attribute (set by viewport marking)
  const visible = attrs["data-os-visible"] === "1" ? true : undefined;
  const stateAttr = attrs["data-os-state"];
  const rawState = stateAttr ? stateAttr.split(",").filter(f => KNOWN_STATE_FLAGS.has(f)) : undefined;
  const state = rawState && rawState.length > 0 ? rawState : undefined;

  const osNode: OSNode = {
    tag,
    id,
    attributes: filteredAttrs,
    children: postProcess(osChildren),
    visible,
    state,
  };

  return [osNode];
}

function walkChildren(
  children: CDPNode[],
  assigner: IDAssigner,
  nodeMap: NodeMap,
  ctx: WalkContext,
  doTruncate: boolean,
  depth: number = 0
): OSNode[] {
  const result: OSNode[] = [];
  for (const child of children) {
    result.push(...walkNode(child, assigner, nodeMap, ctx, doTruncate, depth));
  }
  return result;
}

/**
 * Post-process: merge adjacent text nodes, remove empty nodes, collapse single-child wrappers
 */
function postProcess(nodes: OSNode[]): OSNode[] {
  // Merge adjacent text nodes
  const merged: OSNode[] = [];
  for (const node of nodes) {
    if (
      node.tag === "#text" &&
      merged.length > 0 &&
      merged[merged.length - 1].tag === "#text"
    ) {
      const prevText = merged[merged.length - 1].text ?? "";
      const currText = node.text ?? "";
      // Only add space if previous or current text had whitespace
      const needsSpace = prevText.length > 0 && currText.length > 0 &&
        !prevText.endsWith(" ") && !currText.startsWith(" ");
      merged[merged.length - 1].text = prevText + (needsSpace ? " " : "") + currText;
    } else {
      merged.push(node);
    }
  }

  // Remove empty non-text nodes with no children and no text
  const filtered = merged.filter((node) => {
    if (node.tag === "#text") return !!node.text?.trim();
    // Keep nodes with IDs (interactive), children, or text content
    if (node.id) return true;
    if (node.children.length > 0) return true;
    if (node.text) return true;
    // Keep img tags (self-closing, may have alt/src)
    if (node.tag === "img") return true;
    // Keep iframe tags (may be inaccessible marker)
    if (node.tag === "iframe") return true;
    return false;
  });

  return filtered;
}
