import type { CDPNode, OSNode, NodeMap } from "../types.js";
import { classify, parseAttributes } from "./element-classifier.js";
import { IDAssigner } from "./id-assigner.js";
import { truncateGraphemes } from "./truncation.js";

const KNOWN_STATE_FLAGS = new Set(["disabled", "inert", "obscured"]);

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

interface WalkResult {
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
  viewportMarked: boolean;
  classifyOptions: { includeHidden: boolean; computedVisibility: boolean };
}

/**
 * CDPNode with the snapshot decoder's pre-parsed attribute record. walkDOM
 * reads it to skip re-parsing the flat name/value pairs, which stay the
 * public CDPNode surface.
 */
export interface AttributedCDPNode extends CDPNode {
  parsedAttributes?: Record<string, string>;
}

/**
 * Attributes the element classifier reads beyond the pass-through set
 * (element-classifier.ts checks these on the raw record).
 */
const CLASSIFIER_ATTRS = new Set([
  "aria-hidden",
  "hidden",
  "role",
  "style",
]);

function walkAttributes(
  node: CDPNode,
  markerContext: MarkerContext
): Record<string, string> {
  const parsed = (node as AttributedCDPNode).parsedAttributes;
  const markers = markerContext.markers;
  if (!markers) {
    return parsed ?? parseAttributes(node.attributes);
  }

  // Single pass: keep only what downstream consumers read (pass-through
  // output attributes, classifier attributes, normalized markers) instead of
  // cloning every attribute (class/style/data-*) and filtering later.
  const values = Object.create(null) as Record<string, string>;
  let visible: string | undefined;
  let hidden: string | undefined;
  let state: string | undefined;
  let text: string | undefined;
  const readAttribute = (key: string, value: string): void => {
    if (key === markers.visible) { visible = value; return; }
    if (key === markers.hidden) { hidden = value; return; }
    if (key === markers.state) { state = value; return; }
    if (key === markers.text) { text = value; return; }
    if (PASS_THROUGH_ATTRS.has(key) || CLASSIFIER_ATTRS.has(key)) {
      values[key] = value;
    }
  };
  if (parsed) {
    for (const key in parsed) readAttribute(key, parsed[key]);
  } else {
    const flat = node.attributes;
    const length = flat?.length ?? 0;
    for (let index = 0; index < length; index += 2) {
      readAttribute(flat![index], flat![index + 1]);
    }
  }
  if (visible !== undefined) values["data-os-visible"] = visible;
  if (hidden !== undefined) values["data-os-hidden"] = hidden;
  if (state !== undefined) values["data-os-state"] = state;
  if (text !== undefined) values["data-os-text"] = text;
  return values;
}

function outputAttributes(
  attributes: Record<string, string>,
  id?: string
): Record<string, string> {
  const result: Record<string, string> = {};
  if (id) result["id"] = id;
  for (const key in attributes) {
    if (Object.hasOwn(attributes, key) && PASS_THROUGH_ATTRS.has(key)) {
      result[key] = attributes[key];
    }
  }
  return result;
}

function markerState(attributes: Record<string, string>): string[] | undefined {
  const value = attributes["data-os-state"];
  if (!value) return undefined;
  const state = value.split(",").filter((flag) => KNOWN_STATE_FLAGS.has(flag));
  return state.length > 0 ? state : undefined;
}

interface WalkContext {
  insideInteractive: boolean;
  insideHeading: boolean;
  viewportVisible?: boolean;
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
  if (values === "") return EMPTY_TEXT_INDICES;
  const indices = new Set<number>();
  for (const value of values.split(",")) {
    if (value === "") continue;
    const index = Number(value);
    if (Number.isInteger(index) && index >= 0) indices.add(index);
  }
  return indices;
}

const EMPTY_TEXT_INDICES: ReadonlySet<number> = new Set();

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
    viewportMarked?: boolean;
  }
): WalkResult {
  const assigner = new IDAssigner();
  const nodeMap: NodeMap = new Map();
  const doTruncate = options?.truncate !== false;
  const includeHidden = options?.includeHidden === true;
  const markerContext: MarkerContext = {
    markers: options?.markerAttributes,
    viewportMarked: options?.viewportMarked === true,
    classifyOptions: {
      includeHidden,
      computedVisibility: options?.markerAttributes !== undefined,
    },
  };
  const ctx: WalkContext = { insideInteractive: false, insideHeading: false };

  const nodes: OSNode[] = [];
  walkChildren(
    root.children ?? [],
    nodes,
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
  target: OSNode[],
  assigner: IDAssigner,
  nodeMap: NodeMap,
  ctx: WalkContext,
  doTruncate: boolean,
  includeHidden: boolean,
  markerContext: MarkerContext,
  depth: number
): void {
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
    target.push(truncated);
    return;
  }

  if (node.nodeType === 3) {
    let text = (node.nodeValue ?? "").trim();
    if (!text) return;
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
    target.push(textNode);
    return;
  }

  if (node.nodeType !== 1) return;

  const attrs = walkAttributes(node, markerContext);
  const children = node.children ?? [];
  const elementCtx: WalkContext = markerContext.viewportMarked
    ? {
        insideInteractive: ctx.insideInteractive,
        insideHeading: ctx.insideHeading,
        viewportVisible: attrs["data-os-visible"] === "1",
      }
    : ctx;
  const directTextVisibility = visibleTextIndices(attrs, markerContext);
  const shadowTextVisibility = visibleTextIndices(attrs, markerContext, true);

  if (!includeHidden && attrs["data-os-hidden"] === "self") {
    for (const child of children) {
      if (child.nodeType !== 1) continue;
      walkNode(
        child,
        target,
        assigner,
        nodeMap,
        elementCtx,
        doTruncate,
        includeHidden,
        markerContext,
        depth + 1
      );
    }
    for (const shadowRoot of node.shadowRoots ?? []) {
      walkChildren(
        shadowRoot.children ?? [],
        target,
        assigner,
        nodeMap,
        elementCtx,
        doTruncate,
        includeHidden,
        markerContext,
        depth + 1,
        shadowTextVisibility
      );
    }
    return;
  }

  const result = classify(
    node.nodeName,
    attrs,
    children,
    markerContext.classifyOptions
  );

  if (result.action === "DISCARD") return;

  if (result.action === "COLLAPSE") {
    walkChildren(
      children,
      target,
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
      walkChildren(
        shadowRoot.children ?? [],
        target,
        assigner,
        nodeMap,
        elementCtx,
        doTruncate,
        includeHidden,
        markerContext,
        depth + 1,
        shadowTextVisibility
      );
    }
    return;
  }

  const tag = result.mappedTag!;
  const visible = attrs["data-os-visible"] === "1" ? true : undefined;
  const state = markerState(attrs);

  if (tag === "iframe") {
    const filteredAttrs = outputAttributes(attrs);

    if (node.contentDocument) {
      const iframeChildren: OSNode[] = [];
      walkChildren(
        node.contentDocument.children ?? [],
        iframeChildren,
        assigner,
        nodeMap,
        elementCtx,
        doTruncate,
        includeHidden,
        markerContext,
        depth + 1,
        directTextVisibility
      );
      target.push({
        tag: "iframe",
        attributes: filteredAttrs,
        children: postProcess(iframeChildren),
        visible,
        state,
      });
      return;
    }
    target.push({
      tag: "iframe",
      attributes: { ...filteredAttrs, status: "inaccessible" },
      children: [],
      visible,
      state,
    });
    return;
  }

  const id = assigner.assign(tag);

  if (id) {
    nodeMap.set(id, node.backendNodeId);
  }

  const filteredAttrs = outputAttributes(attrs, id);

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

  const childCtx: WalkContext = {
    insideInteractive: elementCtx.insideInteractive || !!id,
    insideHeading: elementCtx.insideHeading || HEADING_TAGS.has(tag),
    viewportVisible: elementCtx.viewportVisible,
  };

  const osChildren: OSNode[] = [];
  walkChildren(
    children,
    osChildren,
    assigner,
    nodeMap,
    childCtx,
    doTruncate,
    includeHidden,
    markerContext,
    depth + 1,
    directTextVisibility
  );

  for (const shadowRoot of node.shadowRoots ?? []) {
    walkChildren(
      shadowRoot.children ?? [],
      osChildren,
      assigner,
      nodeMap,
      childCtx,
      doTruncate,
      includeHidden,
      markerContext,
      depth + 1,
      shadowTextVisibility
    );
  }

  target.push({
    tag,
    id,
    attributes: filteredAttrs,
    children: postProcess(osChildren),
    visible,
    state,
  });
}

function walkChildren(
  children: CDPNode[],
  target: OSNode[],
  assigner: IDAssigner,
  nodeMap: NodeMap,
  ctx: WalkContext,
  doTruncate: boolean,
  includeHidden: boolean,
  markerContext: MarkerContext,
  depth: number,
  directTextVisibility?: ReadonlySet<number>
): void {
  for (let index = 0; index < children.length; index++) {
    const child = children[index];
    const childCtx =
      child.nodeType === 3 && directTextVisibility
        ? {
            insideInteractive: ctx.insideInteractive,
            insideHeading: ctx.insideHeading,
            viewportVisible: directTextVisibility.has(index),
          }
        : ctx;
    walkNode(
      child,
      target,
      assigner,
      nodeMap,
      childCtx,
      doTruncate,
      includeHidden,
      markerContext,
      depth
    );
  }
}

/** Merge adjacent text and remove empty non-semantic nodes. */
function postProcess(nodes: OSNode[]): OSNode[] {
  let length = 0;
  let mergeBarrier = false;
  // Merge runs are buffered and joined once: concatenating the accumulated
  // string on every merge is quadratic in the run's total length.
  let mergeTarget: OSNode | null = null;
  let mergeParts: string[] | null = null;
  const flushMerge = (): void => {
    if (mergeTarget !== null && mergeParts !== null) {
      mergeTarget.text = mergeParts.join("");
    }
    mergeTarget = null;
    mergeParts = null;
  };

  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    if (node.tag === "#text") {
      if (!node.text?.trim()) {
        mergeBarrier = true;
        continue;
      }
      const previous = nodes[length - 1];
      if (
        mergeBarrier ||
        !previous ||
        previous.tag !== "#text" ||
        previous.visible !== node.visible
      ) {
        flushMerge();
        nodes[length++] = node;
        mergeBarrier = false;
        continue;
      }
      if (mergeTarget !== previous) {
        flushMerge();
        mergeTarget = previous;
        mergeParts = [previous.text ?? ""];
      }
      const currText = node.text ?? "";
      const lastPiece = mergeParts![mergeParts!.length - 1];
      const needsSpace = lastPiece.length > 0 && currText.length > 0 &&
        !lastPiece.endsWith(" ") && !currText.startsWith(" ");
      if (needsSpace) mergeParts!.push(" ");
      mergeParts!.push(currText);
      continue;
    }

    flushMerge();
    const keep =
      node.id ||
      node.children.length > 0 ||
      node.text ||
      node.tag === "img" ||
      node.tag === "iframe";
    if (keep) {
      nodes[length++] = node;
      mergeBarrier = false;
    } else {
      mergeBarrier = true;
    }
  }

  flushMerge();
  nodes.length = length;
  return nodes;
}
