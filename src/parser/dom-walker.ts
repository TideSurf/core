import type { CDPNode, OSNode, NodeMap } from "../types.js";
import { classify, parseAttributes } from "./element-classifier.js";
import { IDAssigner } from "./id-assigner.js";
import { truncateGraphemes } from "./truncation.js";

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

interface MarkerAttributes {
  visible: string;
  hidden: string;
  state: string;
  text?: string;
}

interface MarkerContext {
  markers: MarkerAttributes | undefined;
  ignoreLegacyMarkers: boolean;
  viewportMarked: boolean;
}

function walkAttributes(
  attributes: string[] | undefined,
  markerContext: MarkerContext
): Record<string, string> {
  const values = parseAttributes(attributes);
  if (!markerContext.markers && !markerContext.ignoreLegacyMarkers) return values;
  const markers = markerContext.markers;
  const visible = markers ? values[markers.visible] : undefined;
  const hidden = markers ? values[markers.hidden] : undefined;
  const state = markers ? values[markers.state] : undefined;
  const text = markers?.text ? values[markers.text] : undefined;
  delete values["data-os-visible"];
  delete values["data-os-hidden"];
  delete values["data-os-state"];
  delete values["data-os-text"];
  if (markers) {
    delete values[markers.visible];
    delete values[markers.hidden];
    delete values[markers.state];
    if (markers.text) delete values[markers.text];
  }
  if (visible !== undefined) values["data-os-visible"] = visible;
  if (hidden !== undefined) values["data-os-hidden"] = hidden;
  if (state !== undefined) values["data-os-state"] = state;
  if (text !== undefined) values["data-os-text"] = text;
  return values;
}

interface WalkContext {
  insideInteractive: boolean;
  insideHeading: boolean;
  viewportVisible?: boolean;
}

function appendNodes(target: OSNode[], nodes: OSNode[]): void {
  for (const node of nodes) target.push(node);
}

function visibleTextIndices(
  attrs: Record<string, string>,
  markerContext: MarkerContext,
  shadowRoot: boolean = false
): ReadonlySet<number> | undefined {
  if (!markerContext.viewportMarked || !markerContext.markers?.text) {
    return undefined;
  }
  const encoded = attrs["data-os-text"] ?? "";
  const separator = encoded.indexOf("|");
  const values = shadowRoot
    ? separator < 0
      ? ""
      : encoded.slice(separator + 1)
    : separator < 0
      ? encoded
      : encoded.slice(0, separator);
  const indices = new Set<number>();
  for (const value of values.split(",")) {
    if (value === "") continue;
    const index = Number(value);
    if (Number.isInteger(index) && index >= 0) indices.add(index);
  }
  return indices;
}

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "heading"]);
const TEXT_TRUNCATE_LIMIT = 60;

/**
 * Walk a CDP DOM tree and produce compressed OSNode tree + nodeMap.
 * @param truncate - Set false to disable text truncation (e.g. for search)
 */
const MAX_DEPTH = 500;

export function walkDOM(
  root: CDPNode,
  options?: {
    truncate?: boolean;
    includeHidden?: boolean;
    markerAttributes?: MarkerAttributes;
    ignoreLegacyMarkers?: boolean;
    viewportMarked?: boolean;
  }
): WalkResult {
  const assigner = new IDAssigner();
  const nodeMap: NodeMap = new Map();
  const doTruncate = options?.truncate !== false;
  const includeHidden = options?.includeHidden === true;
  const markerContext: MarkerContext = {
    markers: options?.markerAttributes,
    ignoreLegacyMarkers: options?.ignoreLegacyMarkers === true,
    viewportMarked: options?.viewportMarked === true,
  };
  const ctx: WalkContext = { insideInteractive: false, insideHeading: false };

  const nodes = walkChildren(
    root.children ?? [],
    assigner,
    nodeMap,
    ctx,
    doTruncate,
    includeHidden,
    markerContext,
    0
  );
  const cleaned = postProcess(nodes);

  return { nodes: cleaned, nodeMap };
}

function walkNode(
  node: CDPNode,
  assigner: IDAssigner,
  nodeMap: NodeMap,
  ctx: WalkContext,
  doTruncate: boolean,
  includeHidden: boolean,
  markerContext: MarkerContext,
  depth: number = 0
): OSNode[] {
  // Prevent stack overflow on deeply nested DOM
  if (depth > MAX_DEPTH) {
    const truncated: OSNode = {
      tag: "#text",
      text: "[truncated]",
      attributes: {},
      children: [],
    };
    if (ctx.viewportVisible !== undefined) {
      truncated.visible = ctx.viewportVisible;
    }
    return [truncated];
  }

  // Text nodes
  if (node.nodeType === 3) {
    let text = (node.nodeValue ?? "").trim();
    if (!text) return [];
    if (doTruncate && !ctx.insideInteractive && !ctx.insideHeading) {
      text = truncateGraphemes(text, TEXT_TRUNCATE_LIMIT, {
        suffix: "...",
        preferWordBoundary: true,
      });
    }
    const textNode: OSNode = { tag: "#text", attributes: {}, children: [], text };
    if (ctx.viewportVisible !== undefined) {
      textNode.visible = ctx.viewportVisible;
    }
    return [textNode];
  }

  // Only process element nodes
  if (node.nodeType !== 1) return [];

  const attrs = walkAttributes(node.attributes, markerContext);
  const children = node.children ?? [];
  const elementCtx: WalkContext = markerContext.viewportMarked
    ? { ...ctx, viewportVisible: attrs["data-os-visible"] === "1" }
    : ctx;
  const directTextVisibility = visibleTextIndices(attrs, markerContext);
  const shadowTextVisibility = visibleTextIndices(attrs, markerContext, true);

  if (!includeHidden && attrs["data-os-hidden"] === "self") {
    const promoted = walkChildren(
      children.filter((child) => child.nodeType === 1),
      assigner,
      nodeMap,
      elementCtx,
      doTruncate,
      includeHidden,
      markerContext,
      depth + 1,
      directTextVisibility
    );
    for (const shadowRoot of node.shadowRoots ?? []) {
      appendNodes(
        promoted,
        walkChildren(
          shadowRoot.children ?? [],
          assigner,
          nodeMap,
          elementCtx,
          doTruncate,
          includeHidden,
          markerContext,
          depth + 1,
          shadowTextVisibility
        )
      );
    }
    return promoted;
  }

  const result = classify(
    node.nodeName,
    attrs,
    children,
    {
      includeHidden,
      computedVisibility: markerContext.markers !== undefined,
    }
  );

  if (result.action === "DISCARD") return [];

  if (result.action === "COLLAPSE") {
    // Promote children
    const promoted = walkChildren(
      children,
      assigner,
      nodeMap,
      elementCtx,
      doTruncate,
      includeHidden,
      markerContext,
      depth + 1,
      directTextVisibility
    );
    // Also walk shadow roots if present
    if (node.shadowRoots) {
      for (const shadowRoot of node.shadowRoots) {
        appendNodes(
          promoted,
          walkChildren(
            shadowRoot.children ?? [],
            assigner,
            nodeMap,
            elementCtx,
            doTruncate,
            includeHidden,
            markerContext,
            depth + 1,
            shadowTextVisibility
          )
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
    for (const [key, value] of Object.entries(attrs)) {
      if (PASS_THROUGH_ATTRS.has(key)) filteredAttrs[key] = value;
    }

    if (node.contentDocument) {
      // Same-origin iframe — walk into its content
      const iframeChildren = walkChildren(
        node.contentDocument.children ?? [],
        assigner,
        nodeMap,
        elementCtx,
        doTruncate,
        includeHidden,
        markerContext,
        depth + 1,
        directTextVisibility
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

  for (const [key, value] of Object.entries(attrs)) {
    if (PASS_THROUGH_ATTRS.has(key)) filteredAttrs[key] = value;
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
    insideInteractive: elementCtx.insideInteractive || !!id,
    insideHeading: elementCtx.insideHeading || HEADING_TAGS.has(tag),
    viewportVisible: elementCtx.viewportVisible,
  };

  // Walk regular children
  const osChildren = walkChildren(
    children,
    assigner,
    nodeMap,
    childCtx,
    doTruncate,
    includeHidden,
    markerContext,
    depth + 1,
    directTextVisibility
  );

  // Walk shadow roots and merge shadow children into host's children
  if (node.shadowRoots) {
    for (const shadowRoot of node.shadowRoots) {
      appendNodes(
        osChildren,
        walkChildren(
          shadowRoot.children ?? [],
          assigner,
          nodeMap,
          childCtx,
          doTruncate,
          includeHidden,
          markerContext,
          depth + 1,
          shadowTextVisibility
        )
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
  includeHidden: boolean,
  markerContext: MarkerContext,
  depth: number = 0,
  directTextVisibility?: ReadonlySet<number>
): OSNode[] {
  const result: OSNode[] = [];
  for (let index = 0; index < children.length; index++) {
    const child = children[index];
    const childCtx =
      child.nodeType === 3 && directTextVisibility
        ? { ...ctx, viewportVisible: directTextVisibility.has(index) }
        : ctx;
    appendNodes(
      result,
      walkNode(
        child,
        assigner,
        nodeMap,
        childCtx,
        doTruncate,
        includeHidden,
        markerContext,
        depth
      )
    );
  }
  return result;
}

/** Merge adjacent text and remove empty non-semantic nodes. */
function postProcess(nodes: OSNode[]): OSNode[] {
  const result: OSNode[] = [];
  // A removed node still separates neighboring text, matching source order.
  let mergeBarrier = false;
  for (const node of nodes) {
    if (node.tag === "#text") {
      if (!node.text?.trim()) {
        mergeBarrier = true;
        continue;
      }
      const previous = result[result.length - 1];
      if (
        mergeBarrier ||
        !previous ||
        previous.tag !== "#text" ||
        previous.visible !== node.visible
      ) {
        result.push(node);
        mergeBarrier = false;
        continue;
      }
      const prevText = previous.text ?? "";
      const currText = node.text ?? "";
      const needsSpace = prevText.length > 0 && currText.length > 0 &&
        !prevText.endsWith(" ") && !currText.startsWith(" ");
      previous.text = prevText + (needsSpace ? " " : "") + currText;
      continue;
    }

    const keep =
      node.id ||
      node.children.length > 0 ||
      node.text ||
      node.tag === "img" ||
      node.tag === "iframe";
    if (keep) {
      result.push(node);
      mergeBarrier = false;
    } else {
      mergeBarrier = true;
    }
  }

  return result;
}
