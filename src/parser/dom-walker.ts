import type { CDPNode, OSNode, NodeMap } from "../types.js";
import { classify, parseAttributes } from "./element-classifier.js";
import { IDAssigner } from "./id-assigner.js";

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
  "name",
  "action",
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
  "data-testid",
]);

export interface WalkResult {
  nodes: OSNode[];
  nodeMap: NodeMap;
}

/**
 * Walk a CDP DOM tree and produce compressed OSNode tree + nodeMap
 */
export function walkDOM(root: CDPNode): WalkResult {
  const assigner = new IDAssigner();
  const nodeMap: NodeMap = new Map();

  const nodes = walkChildren(root.children ?? [], assigner, nodeMap);
  const cleaned = postProcess(nodes);

  return { nodes: cleaned, nodeMap };
}

function walkNode(
  node: CDPNode,
  assigner: IDAssigner,
  nodeMap: NodeMap
): OSNode[] {
  // Text nodes
  if (node.nodeType === 3) {
    const text = (node.nodeValue ?? "").trim();
    if (!text) return [];
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
    const promoted = walkChildren(children, assigner, nodeMap);
    // Also walk shadow roots if present
    if (node.shadowRoots) {
      for (const shadowRoot of node.shadowRoots) {
        promoted.push(
          ...walkChildren(shadowRoot.children ?? [], assigner, nodeMap)
        );
      }
    }
    return promoted;
  }

  // KEEP
  const tag = result.mappedTag!;

  // Special handling for IFRAME
  if (tag === "iframe") {
    if (node.contentDocument) {
      // Same-origin iframe — walk into its content
      const iframeChildren = walkChildren(
        node.contentDocument.children ?? [],
        assigner,
        nodeMap
      );
      const filteredAttrs: Record<string, string> = {};
      for (const key of PASS_THROUGH_ATTRS) {
        if (attrs[key] !== undefined) {
          filteredAttrs[key] = attrs[key];
        }
      }
      return [
        {
          tag: "iframe",
          attributes: filteredAttrs,
          children: postProcess(iframeChildren),
        },
      ];
    } else {
      // Cross-origin iframe — emit inaccessible marker
      return [
        {
          tag: "iframe",
          attributes: { status: "inaccessible" },
          children: [],
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

  // Walk regular children
  const osChildren = walkChildren(children, assigner, nodeMap);

  // Walk shadow roots and merge shadow children into host's children
  if (node.shadowRoots) {
    for (const shadowRoot of node.shadowRoots) {
      osChildren.push(
        ...walkChildren(shadowRoot.children ?? [], assigner, nodeMap)
      );
    }
  }

  // Check for visibility attribute (set by viewport marking)
  const visible = attrs["data-os-visible"] === "1" ? true : undefined;

  const osNode: OSNode = {
    tag,
    id,
    attributes: filteredAttrs,
    children: postProcess(osChildren),
    visible,
  };

  return [osNode];
}

function walkChildren(
  children: CDPNode[],
  assigner: IDAssigner,
  nodeMap: NodeMap
): OSNode[] {
  const result: OSNode[] = [];
  for (const child of children) {
    result.push(...walkNode(child, assigner, nodeMap));
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
      merged[merged.length - 1].text += " " + node.text;
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
