import { randomUUID } from "node:crypto";
import type { CDPNode } from "../types.js";
import { MAX_DOM_NODES, type CDPConnection } from "./connection.js";
import { withTimeout } from "./timeout.js";

export const SNAPSHOT_COMPUTED_STYLES = [
  "display",
  "visibility",
  "opacity",
  "content-visibility",
  "clip-path",
  "overflow-x",
  "overflow-y",
  "pointer-events",
  "contain",
  "clip",
  "position",
] as const;
const MAX_SNAPSHOT_CHARACTERS = 16_000_000;
type SnapshotStyle = (typeof SNAPSHOT_COMPUTED_STYLES)[number];

export interface InspectionMarkerAttributes {
  visible: string;
  hidden: string;
  state: string;
  text: string;
}

interface PageInspection {
  url: string;
  title: string;
  scrollY: number;
  scrollHeight: number;
  viewportHeight: number;
  markerAttributes: InspectionMarkerAttributes;
}

interface RareStringData {
  index?: number[];
  value?: number[];
}

interface RareBooleanData {
  index?: number[];
}

interface RareIntegerData {
  index?: number[];
  value?: number[];
}

interface SnapshotNodes {
  parentIndex?: number[];
  nodeType?: number[];
  shadowRootType?: RareStringData;
  nodeName?: number[];
  nodeValue?: number[];
  backendNodeId?: number[];
  attributes?: number[][];
  textValue?: RareStringData;
  inputValue?: RareStringData;
  inputChecked?: RareBooleanData;
  optionSelected?: RareBooleanData;
  contentDocumentIndex?: RareIntegerData;
}

interface SnapshotLayout {
  nodeIndex?: number[];
  styles?: number[][];
  bounds?: number[][];
}

interface SnapshotDocument {
  documentURL: number;
  title: number;
  frameId: number;
  nodes: SnapshotNodes;
  layout: SnapshotLayout;
  scrollOffsetX?: number;
  scrollOffsetY?: number;
  contentWidth?: number;
  contentHeight?: number;
}

export interface DOMSnapshotData {
  documents: SnapshotDocument[];
  strings: string[];
}

export interface DecodeSnapshotOptions {
  viewportWidth: number;
  viewportHeight: number;
  markViewport?: boolean;
  markHidden?: boolean;
  maxNodes?: number;
  markerAttributes?: InspectionMarkerAttributes;
  computedStyles?: readonly SnapshotStyle[];
}

export interface CaptureSnapshotOptions {
  markViewport: boolean;
  markHidden: boolean;
  timeout?: number;
  maxNodes?: number;
}

/**
 * A page inspection and DOM tree read from one browser snapshot. Paint-order
 * obscuration is intentionally omitted because the snapshot has no hit-test
 * result; visibility still accounts for layout, viewport, overflow, and inset
 * clipping.
 */
export interface SnapshotCapture extends PageInspection {
  root: CDPNode;
}

type Attributes = Record<string, string>;

interface Bounds {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface LayoutData {
  bounds: Bounds;
  style: Record<SnapshotStyle, string>;
}

interface DecodedDocument {
  source: SnapshotDocument;
  nodes: CDPNode[];
  parents: number[];
  children: Array<number[] | undefined>;
  attributes: Attributes[];
  layouts: Array<LayoutData | undefined>;
  contentDocuments: Map<number, number>;
  root: CDPNode;
  effectiveBounds: Array<Bounds | undefined>;
  hiddenSelf: Uint8Array;
  hiddenSubtree: Uint8Array;
  inertSubtree: Uint8Array;
  ariaDisabledSubtree: Uint8Array;
  disabledFieldsetDepth: Uint16Array;
}

const UNBOUNDED: Bounds = {
  top: -Infinity,
  right: Infinity,
  bottom: Infinity,
  left: -Infinity,
};
const EMPTY_BOUNDS: Bounds = { top: 0, right: 0, bottom: 0, left: 0 };

const NO_LAYOUT_EXEMPT = new Set(["OPTION", "OPTGROUP"]);
const FIELDSET_CONTROLS = new Set(["BUTTON", "INPUT", "SELECT", "TEXTAREA"]);

function snapshotMarkers(): InspectionMarkerAttributes {
  const suffix = randomUUID().replaceAll("-", "");
  return {
    visible: `data-tidesurf-${suffix}-visible`,
    hidden: `data-tidesurf-${suffix}-hidden`,
    state: `data-tidesurf-${suffix}-state`,
    text: `data-tidesurf-${suffix}-text`,
  };
}

function finite(value: unknown, fallback: number = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function positiveLimit(value: number | undefined): number {
  if (value === undefined) return MAX_DOM_NODES;
  if (!Number.isInteger(value) || value < 1 || value > MAX_DOM_NODES) {
    throw new RangeError(`maxNodes must be an integer from 1 to ${MAX_DOM_NODES}`);
  }
  return value;
}

function assertViewport(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number`);
  }
}

function nodeLimitError(limit: number, count: number): Error {
  const found = count > limit ? `more than ${limit.toLocaleString()}` : count.toLocaleString();
  return new Error(
    `DOM exceeds maximum node count of ${limit.toLocaleString()} (found ${found}). ` +
      "Reduce page complexity or navigate to a smaller page."
  );
}

function stringAt(strings: string[], index: number | undefined): string {
  if (index === undefined || index === -1) return "";
  const value = strings[index];
  if (typeof value !== "string") {
    throw new Error(`DOM snapshot contains an invalid string index: ${index}`);
  }
  return value;
}

function rareValues<T>(
  data: RareStringData | RareIntegerData | undefined,
  read: (value: number) => T
): Map<number, T> {
  const indices = data?.index ?? [];
  const values = data?.value ?? [];
  if (indices.length !== values.length) {
    throw new Error("DOM snapshot rare-data columns have different lengths");
  }
  const result = new Map<number, T>();
  for (let position = 0; position < indices.length; position++) {
    result.set(indices[position], read(values[position]));
  }
  return result;
}

function rareFlags(data: RareBooleanData | undefined): Set<number> {
  return new Set(data?.index ?? []);
}

function decodeAttributes(encoded: number[] | undefined, strings: string[]): Attributes {
  if (!encoded) return {};
  if (encoded.length % 2 !== 0) {
    throw new Error("DOM snapshot contains an unpaired attribute");
  }
  const attributes: Attributes = {};
  for (let index = 0; index < encoded.length; index += 2) {
    attributes[stringAt(strings, encoded[index])] = stringAt(strings, encoded[index + 1]);
  }
  return attributes;
}

function flattenAttributes(attributes: Attributes): string[] {
  const flattened: string[] = [];
  for (const [name, value] of Object.entries(attributes)) {
    flattened.push(name, value);
  }
  return flattened;
}

function layoutBounds(value: number[] | undefined): Bounds | undefined {
  if (!value || value.length < 4) return undefined;
  const [left, top, width, height] = value;
  if (![left, top, width, height].every(Number.isFinite)) return undefined;
  return {
    top,
    right: left + Math.max(0, width),
    bottom: top + Math.max(0, height),
    left,
  };
}

function intersect(
  first: Bounds,
  second: Bounds,
  clipX: boolean = true,
  clipY: boolean = true
): Bounds | undefined {
  const bounds = {
    top: clipY ? Math.max(first.top, second.top) : first.top,
    right: clipX ? Math.min(first.right, second.right) : first.right,
    bottom: clipY ? Math.min(first.bottom, second.bottom) : first.bottom,
    left: clipX ? Math.max(first.left, second.left) : first.left,
  };
  return bounds.right > bounds.left && bounds.bottom > bounds.top ? bounds : undefined;
}

function parseClipLength(value: string, size: number): number | undefined {
  const token = value.trim().toLowerCase();
  const parsed = Number.parseFloat(token);
  if (!Number.isFinite(parsed)) return undefined;
  if (token.endsWith("%")) return (size * parsed) / 100;
  if (token.endsWith("px") || token === "0" || token === "-0") return parsed;
  return undefined;
}

function insetBounds(value: string, bounds: Bounds): Bounds | null | undefined {
  const source = value.trim();
  if (!source.toLowerCase().startsWith("inset(") || !source.endsWith(")")) {
    return undefined;
  }
  let body = source.slice(source.indexOf("(") + 1, -1).trim();
  const round = body.toLowerCase().indexOf(" round ");
  if (round >= 0) body = body.slice(0, round).trim();
  const tokens = body.split(/\s+/).filter(Boolean);
  if (tokens.length < 1 || tokens.length > 4) return undefined;
  const values = tokens.length === 1
    ? [tokens[0], tokens[0], tokens[0], tokens[0]]
    : tokens.length === 2
      ? [tokens[0], tokens[1], tokens[0], tokens[1]]
      : tokens.length === 3
        ? [tokens[0], tokens[1], tokens[2], tokens[1]]
        : tokens;
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  const top = parseClipLength(values[0], height);
  const right = parseClipLength(values[1], width);
  const bottom = parseClipLength(values[2], height);
  const left = parseClipLength(values[3], width);
  if (top === undefined || right === undefined || bottom === undefined || left === undefined) {
    return undefined;
  }
  const clipped = {
    top: bounds.top + top,
    right: bounds.right - right,
    bottom: bounds.bottom - bottom,
    left: bounds.left + left,
  };
  return clipped.right > clipped.left && clipped.bottom > clipped.top ? clipped : null;
}

function circleRadius(value: string, width: number, height: number): number | undefined {
  const token = value.trim().toLowerCase();
  const parsed = Number.parseFloat(token);
  if (!Number.isFinite(parsed)) return undefined;
  if (token.endsWith("%")) {
    return (Math.hypot(width, height) / Math.SQRT2) * parsed / 100;
  }
  if (token.endsWith("px") || token === "0" || token === "-0") return parsed;
  return undefined;
}

function circleBounds(value: string, bounds: Bounds): Bounds | null | undefined {
  const match = /^circle\((.*)\)$/i.exec(value.trim());
  if (!match) return undefined;
  const [radiusSource, positionSource] = match[1].split(/\s+at\s+/i, 2);
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  const radius = circleRadius(radiusSource, width, height);
  if (radius === undefined) return undefined;
  if (radius <= 0) return null;

  const position = positionSource?.trim().split(/\s+/) ?? ["50%", "50%"];
  if (position.length < 1 || position.length > 2) return undefined;
  const x = parseClipLength(position[0], width);
  const y = parseClipLength(position[1] ?? position[0], height);
  if (x === undefined || y === undefined) return undefined;
  return {
    top: bounds.top + y - radius,
    right: bounds.left + x + radius,
    bottom: bounds.top + y + radius,
    left: bounds.left + x - radius,
  };
}

function clipPathBounds(value: string, bounds: Bounds): Bounds | null | undefined {
  const inset = insetBounds(value, bounds);
  return inset !== undefined ? inset : circleBounds(value, bounds);
}

function legacyClipBounds(value: string, bounds: Bounds): Bounds | null | undefined {
  const match = /^rect\((.*)\)$/i.exec(value.trim());
  if (!match) return undefined;
  const tokens = match[1].trim().split(/\s*(?:,|\s)\s*/).filter(Boolean);
  if (tokens.length !== 4) return undefined;
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  const length = (token: string, size: number): number | undefined =>
    token.toLowerCase() === "auto" ? size : parseClipLength(token, size);
  const top = length(tokens[0], height);
  const right = length(tokens[1], width);
  const bottom = length(tokens[2], height);
  const left = length(tokens[3], width);
  if (top === undefined || right === undefined || bottom === undefined || left === undefined) {
    return undefined;
  }
  const clipped = {
    top: bounds.top + top,
    right: bounds.left + right,
    bottom: bounds.top + bottom,
    left: bounds.left + left,
  };
  return clipped.right > clipped.left && clipped.bottom > clipped.top ? clipped : null;
}

function clipsDescendants(style: LayoutData["style"]): boolean {
  const contain = style.contain.toLowerCase().split(/\s+/);
  return contain.includes("paint") || contain.includes("strict") || contain.includes("content");
}

function styleHidingKind(layout: LayoutData | undefined): "self" | "subtree" | undefined {
  if (!layout) return undefined;
  const style = layout.style;
  const visibility = style.visibility.toLowerCase();
  if (visibility === "hidden" || visibility === "collapse") return "self";
  const opacity = Number.parseFloat(style.opacity || "1");
  if (
    style.display.toLowerCase() === "none" ||
    style["content-visibility"].toLowerCase() === "hidden" ||
    (Number.isFinite(opacity) && opacity < 0.01)
  ) {
    return "subtree";
  }
  const clipPath = style["clip-path"].trim().toLowerCase();
  const clipBounds = clipPathBounds(clipPath, layout.bounds);
  if (
    clipPath.replaceAll(" ", "") === "polygon(00,00,00)" ||
    clipBounds === null
  ) {
    return "subtree";
  }
  return undefined;
}

function appendMarker(attributes: Attributes, name: string, value: string): void {
  if (value) attributes[name] = value;
}

function interactive(nodeName: string, attributes: Attributes): boolean {
  const role = attributes["role"];
  return (
    nodeName === "A" ||
    nodeName === "BUTTON" ||
    nodeName === "INPUT" ||
    nodeName === "SELECT" ||
    nodeName === "TEXTAREA" ||
    role === "button" ||
    role === "link" ||
    role === "textbox" ||
    role === "listbox"
  );
}

function buildDocument(
  source: SnapshotDocument,
  strings: string[],
  computedStyles: readonly SnapshotStyle[]
): DecodedDocument {
  const table = source.nodes;
  const nodeTypes = table.nodeType;
  const parents = table.parentIndex;
  const names = table.nodeName;
  const values = table.nodeValue;
  const backendIds = table.backendNodeId;
  if (!nodeTypes || !parents || !names || !backendIds || nodeTypes.length === 0) {
    throw new Error("DOM snapshot is missing required node columns");
  }
  const count = nodeTypes.length;
  if (parents.length !== count || names.length !== count || backendIds.length !== count) {
    throw new Error("DOM snapshot node columns have different lengths");
  }

  const inputValues = rareValues(table.inputValue, (value) => stringAt(strings, value));
  const textValues = rareValues(table.textValue, (value) => stringAt(strings, value));
  const checked = rareFlags(table.inputChecked);
  const selected = rareFlags(table.optionSelected);
  const contentDocuments = rareValues(table.contentDocumentIndex, (value) => value);
  const attributes: Attributes[] = new Array(count);
  const nodes: CDPNode[] = new Array(count);
  const children: Array<number[] | undefined> = new Array(count);
  let rootIndex = -1;

  for (let index = 0; index < count; index++) {
    const parent = parents[index];
    if (!Number.isInteger(parent) || parent < -1 || parent >= index) {
      throw new Error(`DOM snapshot contains an invalid parent index at node ${index}`);
    }
    if (parent === -1) {
      if (rootIndex !== -1) throw new Error("DOM snapshot document has multiple roots");
      rootIndex = index;
    }

    const nodeName = stringAt(strings, names[index]);
    const attrs = decodeAttributes(table.attributes?.[index], strings);
    if (nodeName === "INPUT") {
      const type = (attrs["type"] ?? "text").toLowerCase();
      const liveValue = inputValues.get(index);
      if (type === "password") {
        delete attrs["value"];
      } else if (
        liveValue !== undefined &&
        !((type === "checkbox" || type === "radio") && liveValue === "on" && attrs["value"] === undefined)
      ) {
        attrs["value"] = liveValue;
      }
      if (type === "checkbox" || type === "radio") {
        if (checked.has(index)) attrs["checked"] = "";
        else delete attrs["checked"];
      }
    } else if (nodeName === "TEXTAREA") {
      const liveValue = textValues.get(index);
      if (liveValue !== undefined) attrs["value"] = liveValue;
    } else if (nodeName === "OPTION") {
      if (selected.has(index)) attrs["selected"] = "";
      else delete attrs["selected"];
    }
    attributes[index] = attrs;
    nodes[index] = {
      nodeId: 0,
      backendNodeId: backendIds[index],
      nodeType: nodeTypes[index],
      nodeName,
      localName: nodeTypes[index] === 1 ? nodeName.toLowerCase() : "",
      nodeValue: stringAt(strings, values?.[index]),
      attributes: nodeTypes[index] === 1 ? [] : undefined,
    };
    if (parent >= 0) (children[parent] ??= []).push(index);
  }
  if (rootIndex === -1) throw new Error("DOM snapshot document has no root");

  for (let index = 0; index < count; index++) {
    const childIndices = children[index];
    if (childIndices) {
      nodes[index].children = childIndices.map((childIndex) => nodes[childIndex]);
      nodes[index].childNodeCount = childIndices.length;
    }
  }
  nodes[rootIndex].frameId = stringAt(strings, source.frameId);

  const layouts: Array<LayoutData | undefined> = new Array(count);
  const layoutNodes = source.layout.nodeIndex ?? [];
  const layoutStyles = source.layout.styles ?? [];
  const layoutRects = source.layout.bounds ?? [];
  for (let position = 0; position < layoutNodes.length; position++) {
    const nodeIndex = layoutNodes[position];
    if (!Number.isInteger(nodeIndex) || nodeIndex < 0 || nodeIndex >= count) {
      throw new Error(`DOM snapshot contains an invalid layout node index: ${nodeIndex}`);
    }
    const bounds = layoutBounds(layoutRects[position]);
    if (!bounds) continue;
    const encodedStyle = layoutStyles[position] ?? [];
    const style = Object.fromEntries(
      SNAPSHOT_COMPUTED_STYLES.map((name) => [name, ""])
    ) as LayoutData["style"];
    for (let styleIndex = 0; styleIndex < computedStyles.length; styleIndex++) {
      style[computedStyles[styleIndex]] = stringAt(strings, encodedStyle[styleIndex]);
    }
    layouts[nodeIndex] = { bounds, style };
  }

  return {
    source,
    nodes,
    parents,
    children,
    attributes,
    layouts,
    contentDocuments,
    root: nodes[rootIndex],
    effectiveBounds: new Array(count),
    hiddenSelf: new Uint8Array(count),
    hiddenSubtree: new Uint8Array(count),
    inertSubtree: new Uint8Array(count),
    ariaDisabledSubtree: new Uint8Array(count),
    disabledFieldsetDepth: new Uint16Array(count),
  };
}

function prepareDocument(document: DecodedDocument, markers: InspectionMarkerAttributes): void {
  const count = document.nodes.length;
  const firstLegends = new Int32Array(count);
  firstLegends.fill(-1);
  for (let index = 0; index < count; index++) {
    if (
      document.nodes[index].nodeName !== "FIELDSET" ||
      document.attributes[index]["disabled"] === undefined
    ) {
      continue;
    }
    for (const child of document.children[index] ?? []) {
      if (document.nodes[child].nodeName === "LEGEND") {
        firstLegends[index] = child;
        break;
      }
    }
  }
  const subtreeHasLayout = document.layouts.map(Boolean);
  for (let index = count - 1; index > 0; index--) {
    if (subtreeHasLayout[index]) subtreeHasLayout[document.parents[index]] = true;
  }

  const childClips: Bounds[] = new Array(count);
  for (let index = 0; index < count; index++) {
    const parent = document.parents[index];
    let disabledFieldsetDepth =
      parent >= 0 ? document.disabledFieldsetDepth[parent] : 0;
    if (
      parent >= 0 &&
      document.nodes[parent].nodeName === "FIELDSET" &&
      document.attributes[parent]["disabled"] !== undefined &&
      firstLegends[parent] !== index
    ) {
      disabledFieldsetDepth++;
    }
    document.disabledFieldsetDepth[index] = disabledFieldsetDepth;
    const inheritedClip = parent >= 0 ? childClips[parent] : UNBOUNDED;
    const attrs = document.attributes[index];
    const layout = document.layouts[index];
    const styleKind = styleHidingKind(layout);
    const parentHidden = parent >= 0 && document.hiddenSubtree[parent] !== 0;
    const attributeHidden =
      attrs["hidden"] !== undefined ||
      attrs["aria-hidden"]?.toLowerCase() === "true";
    const noLayoutHidden =
      document.nodes[index].nodeType === 1 &&
      !layout &&
      !subtreeHasLayout[index] &&
      !NO_LAYOUT_EXEMPT.has(document.nodes[index].nodeName);
    const selfKind =
      styleKind && document.nodes[index].nodeName === "IFRAME"
        ? "subtree"
        : styleKind ?? (noLayoutHidden ? "subtree" : undefined);
    document.hiddenSelf[index] =
      parentHidden || attributeHidden || selfKind !== undefined ? 1 : 0;
    document.hiddenSubtree[index] =
      parentHidden || attributeHidden || selfKind === "subtree" ? 1 : 0;

    const ownBounds = layout?.bounds;
    let effective = ownBounds ? intersect(ownBounds, inheritedClip) : undefined;
    const clipPath = layout?.style["clip-path"].trim().toLowerCase() ?? "";
    const pathBounds = ownBounds && clipPath !== "" && clipPath !== "none"
      ? clipPathBounds(clipPath, ownBounds) ?? ownBounds
      : undefined;
    const positioned = layout?.style.position.toLowerCase();
    const legacyBounds = ownBounds && (positioned === "absolute" || positioned === "fixed")
      ? legacyClipBounds(layout?.style.clip ?? "", ownBounds)
      : undefined;
    for (const clip of [pathBounds, legacyBounds]) {
      if (clip) effective = effective ? intersect(effective, clip) : undefined;
      if (clip === null) effective = undefined;
    }
    document.effectiveBounds[index] = effective;

    let childClip = inheritedClip;
    if (layout && ownBounds) {
      const overflowXValue = layout.style["overflow-x"].toLowerCase();
      const overflowYValue = layout.style["overflow-y"].toLowerCase();
      const overflowX = overflowXValue !== "" && overflowXValue !== "visible";
      const overflowY = overflowYValue !== "" && overflowYValue !== "visible";
      if (overflowX || overflowY) {
        childClip = intersect(childClip, ownBounds, overflowX, overflowY) ?? {
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
        };
      }
      if (clipsDescendants(layout.style)) {
        childClip = intersect(childClip, ownBounds) ?? EMPTY_BOUNDS;
      }
      for (const clip of [pathBounds, legacyBounds]) {
        if (clip) childClip = intersect(childClip, clip) ?? EMPTY_BOUNDS;
        if (clip === null) childClip = EMPTY_BOUNDS;
      }
    }
    childClips[index] = childClip;

    document.inertSubtree[index] =
      (parent >= 0 && document.inertSubtree[parent] !== 0) ||
      attrs["inert"] !== undefined ? 1 : 0;
    document.ariaDisabledSubtree[index] =
      (parent >= 0 && document.ariaDisabledSubtree[parent] !== 0) ||
      attrs["aria-disabled"]?.toLowerCase() === "true" ? 1 : 0;

    if (interactive(document.nodes[index].nodeName, attrs)) {
      const states: string[] = [];
      const nativeDisabled =
        FIELDSET_CONTROLS.has(document.nodes[index].nodeName) &&
        (attrs["disabled"] !== undefined || disabledFieldsetDepth > 0);
      if (nativeDisabled || document.ariaDisabledSubtree[index]) {
        states.push("disabled");
      }
      if (
        document.inertSubtree[index] ||
        layout?.style["pointer-events"].toLowerCase() === "none"
      ) {
        states.push("inert");
      }
      appendMarker(attrs, markers.state, states.join(","));
    }

    if (selfKind) appendMarker(attrs, markers.hidden, selfKind);
  }
}

function markDocumentViewport(
  document: DecodedDocument,
  viewport: Bounds | undefined,
  markers: InspectionMarkerAttributes
): void {
  const visible = new Array<boolean>(document.nodes.length).fill(false);
  if (viewport) {
    for (let index = 0; index < document.nodes.length; index++) {
      if (document.hiddenSelf[index]) continue;
      const bounds = document.effectiveBounds[index];
      visible[index] = bounds !== undefined && intersect(bounds, viewport) !== undefined;
      if (visible[index] && document.nodes[index].nodeType === 1) {
        const attrs = document.attributes[index];
        appendMarker(attrs, markers.visible, "1");
      }
    }

    // Native option rows normally have no layout object of their own. Keep
    // their labels with an on-screen select instead of treating them as
    // off-screen content.
    for (let index = 0; index < document.nodes.length; index++) {
      const nodeName = document.nodes[index].nodeName;
      if ((nodeName !== "OPTION" && nodeName !== "OPTGROUP") || document.hiddenSelf[index]) {
        continue;
      }
      const parent = document.parents[index];
      if (parent < 0 || !visible[parent]) continue;
      visible[index] = true;
      appendMarker(document.attributes[index], markers.visible, "1");
      for (const child of document.children[index] ?? []) {
        if (document.nodes[child].nodeType === 3) visible[child] = true;
      }
    }
  }

  for (let index = 0; index < document.nodes.length; index++) {
    if (document.nodes[index].nodeType !== 1) continue;
    const childIndices = document.children[index];
    if (!childIndices) continue;
    const visibleText: number[] = [];
    for (let childPosition = 0; childPosition < childIndices.length; childPosition++) {
      const childIndex = childIndices[childPosition];
      if (document.nodes[childIndex].nodeType === 3 && visible[childIndex]) {
        visibleText.push(childPosition);
      }
    }
    if (visibleText.length > 0) {
      appendMarker(document.attributes[index], markers.text, `${visibleText.join(",")}|`);
    }
  }
}

function frameViewport(
  parent: DecodedDocument,
  ownerIndex: number,
  parentViewport: Bounds | undefined,
  child: DecodedDocument
): Bounds | undefined {
  if (!parentViewport || parent.hiddenSelf[ownerIndex]) return undefined;
  const raw = parent.layouts[ownerIndex]?.bounds;
  const effective = parent.effectiveBounds[ownerIndex];
  if (!raw || !effective) return undefined;
  const exposed = intersect(effective, parentViewport);
  if (!exposed) return undefined;
  const scrollX = finite(child.source.scrollOffsetX);
  const scrollY = finite(child.source.scrollOffsetY);
  return {
    top: scrollY + Math.max(0, exposed.top - raw.top),
    right: scrollX + Math.max(0, exposed.right - raw.left),
    bottom: scrollY + Math.max(0, exposed.bottom - raw.top),
    left: scrollX + Math.max(0, exposed.left - raw.left),
  };
}

function attachDocuments(documents: DecodedDocument[]): Map<number, { document: number; node: number }> {
  const owners = new Map<number, { document: number; node: number }>();
  for (let documentIndex = 0; documentIndex < documents.length; documentIndex++) {
    for (const [nodeIndex, childDocument] of documents[documentIndex].contentDocuments) {
      if (!Number.isInteger(childDocument) || childDocument < 0 || childDocument >= documents.length) {
        throw new Error(`DOM snapshot references an invalid content document: ${childDocument}`);
      }
      if (childDocument === 0 || childDocument === documentIndex || owners.has(childDocument)) {
        throw new Error(`DOM snapshot contains an invalid content-document graph at ${childDocument}`);
      }
      owners.set(childDocument, { document: documentIndex, node: nodeIndex });
      documents[documentIndex].nodes[nodeIndex].contentDocument = documents[childDocument].root;
    }
  }

  const colors = new Uint8Array(documents.length);
  for (const childDocument of owners.keys()) {
    if (colors[childDocument] === 2) continue;
    const path: number[] = [];
    let current = childDocument;
    while (current !== 0 && owners.has(current)) {
      if (colors[current] === 1) {
        throw new Error("DOM snapshot contains a content-document cycle");
      }
      if (colors[current] === 2) break;
      colors[current] = 1;
      path.push(current);
      current = owners.get(current)!.document;
    }
    for (const documentIndex of path) colors[documentIndex] = 2;
  }
  return owners;
}

function snapshotData(value: unknown): DOMSnapshotData {
  if (!value || typeof value !== "object") throw new Error("DOM snapshot response is not an object");
  const candidate = value as Partial<DOMSnapshotData>;
  if (!Array.isArray(candidate.documents) || candidate.documents.length === 0) {
    throw new Error("DOM snapshot response contains no documents");
  }
  if (!Array.isArray(candidate.strings)) {
    throw new Error("DOM snapshot response contains no string table");
  }
  return candidate as DOMSnapshotData;
}

export function decodeDOMSnapshot(
  value: unknown,
  options: DecodeSnapshotOptions
): SnapshotCapture {
  assertViewport(options.viewportWidth, "viewportWidth");
  assertViewport(options.viewportHeight, "viewportHeight");
  const limit = positiveLimit(options.maxNodes);
  const data = snapshotData(value);
  let nodeCount = 0;
  for (const document of data.documents) {
    const nodeTypes = document.nodes?.nodeType;
    if (!Array.isArray(nodeTypes)) throw new Error("DOM snapshot is missing node types");
    nodeCount += nodeTypes.length;
    if (nodeCount > limit) throw nodeLimitError(limit, nodeCount);
  }

  const markers = options.markerAttributes ?? snapshotMarkers();
  const computedStyles = options.computedStyles ?? SNAPSHOT_COMPUTED_STYLES;
  const documents = data.documents.map((document) =>
    buildDocument(document, data.strings, computedStyles)
  );
  const owners = attachDocuments(documents);
  for (const document of documents) prepareDocument(document, markers);

  const main = documents[0];
  const scrollX = finite(main.source.scrollOffsetX);
  const scrollY = finite(main.source.scrollOffsetY);
  if (options.markViewport !== false) {
    const viewports: Array<Bounds | undefined> = new Array(documents.length);
    viewports[0] = {
      top: scrollY,
      right: scrollX + options.viewportWidth,
      bottom: scrollY + options.viewportHeight,
      left: scrollX,
    };
    const frameChildren: Array<Array<{ document: number; node: number }> | undefined> =
      new Array(documents.length);
    for (const [childDocument, owner] of owners) {
      (frameChildren[owner.document] ??= []).push({
        document: childDocument,
        node: owner.node,
      });
    }
    const pending = [0];
    while (pending.length > 0) {
      const parentDocument = pending.pop()!;
      for (const child of frameChildren[parentDocument] ?? []) {
        viewports[child.document] = frameViewport(
          documents[parentDocument],
          child.node,
          viewports[parentDocument],
          documents[child.document]
        );
        pending.push(child.document);
      }
    }
    for (let index = 0; index < documents.length; index++) {
      markDocumentViewport(documents[index], viewports[index], markers);
    }
  }

  for (const document of documents) {
    for (let index = 0; index < document.nodes.length; index++) {
      const attrs = document.attributes[index];
      if (options.markHidden === false) delete attrs[markers.hidden];
      if (document.nodes[index].nodeType === 1) {
        document.nodes[index].attributes = flattenAttributes(attrs);
      }
    }
  }

  const contentHeight = finite(main.source.contentHeight);
  return {
    root: main.root,
    url: stringAt(data.strings, main.source.documentURL),
    title: stringAt(data.strings, main.source.title),
    scrollY,
    scrollHeight: contentHeight,
    viewportHeight: options.viewportHeight,
    markerAttributes: markers,
  };
}

interface PreflightResult {
  nodeCount: number;
  characterCount: number;
  viewportWidth: number;
  viewportHeight: number;
}

function preflightExpression(limit: number): string {
  return `(() => {
  const limit = ${limit};
  const stack = [document];
  let count = 0;
  let characterCount = 0;
  const enqueue = node => {
    if (!node) return true;
    stack.push(node);
    return count + stack.length <= limit;
  };
  while (stack.length > 0) {
    const current = stack.pop();
    count++;
    if (count > limit) break;
    if (current.nodeType === Node.ELEMENT_NODE) {
      const tag = current.tagName;
      const type = tag === 'INPUT' ? (current.getAttribute('type') || 'text').toLowerCase() : '';
      const hasLiveValue = (tag === 'INPUT' && type !== 'password') || tag === 'TEXTAREA';
      const omitsDefaultChoiceValue = tag === 'INPUT' && (type === 'checkbox' || type === 'radio') &&
        !current.hasAttribute('value') && current.value === 'on';
      for (const attribute of current.attributes) {
        if (attribute.name === 'value' && tag === 'INPUT' && type === 'password') continue;
        characterCount += attribute.name.length + attribute.value.length;
        if (hasLiveValue && attribute.name === 'value') characterCount -= attribute.value.length;
      }
      if (hasLiveValue && !omitsDefaultChoiceValue) characterCount += current.value.length;
      if (current.shadowRoot && !enqueue(current.shadowRoot)) return {
        nodeCount: limit + 1, characterCount, viewportWidth: innerWidth, viewportHeight: innerHeight
      };
      if (current.tagName === 'TEMPLATE' && current.content && !enqueue(current.content)) return {
        nodeCount: limit + 1, characterCount, viewportWidth: innerWidth, viewportHeight: innerHeight
      };
      if (current.tagName === 'IFRAME') {
        try {
          if (current.contentDocument && !enqueue(current.contentDocument)) return {
            nodeCount: limit + 1, characterCount, viewportWidth: innerWidth, viewportHeight: innerHeight
          };
        } catch {}
      }
    } else if (current.nodeType === Node.TEXT_NODE) {
      characterCount += current.nodeValue.length;
    }
    if (characterCount > ${MAX_SNAPSHOT_CHARACTERS}) {
      return { nodeCount: count, characterCount, viewportWidth: innerWidth, viewportHeight: innerHeight };
    }
    for (let index = current.childNodes.length - 1; index >= 0; index--) {
      if (!enqueue(current.childNodes[index])) return {
        nodeCount: limit + 1, characterCount, viewportWidth: innerWidth, viewportHeight: innerHeight
      };
    }
  }
  return { nodeCount: count, characterCount, viewportWidth: innerWidth, viewportHeight: innerHeight };
})()`;
}

export async function captureDOMSnapshot(
  conn: CDPConnection,
  options: CaptureSnapshotOptions
): Promise<SnapshotCapture> {
  const timeout = options.timeout ?? 15_000;
  const deadline = Date.now() + timeout;
  const remaining = () => Math.max(1, deadline - Date.now());
  const limit = positiveLimit(options.maxNodes);
  const preflightResponse = await withTimeout(
    conn.Runtime.evaluate({
      expression: preflightExpression(limit),
      returnByValue: true,
    }),
    remaining(),
    "captureDOMSnapshot:preflight"
  );
  if (preflightResponse.exceptionDetails) {
    throw new Error(
      `DOM snapshot preflight failed: ${preflightResponse.exceptionDetails.text ?? "unknown error"}`
    );
  }
  const preflight = preflightResponse.result.value as PreflightResult | undefined;
  if (
    !preflight ||
    !Number.isFinite(preflight.nodeCount) ||
    !Number.isFinite(preflight.characterCount) ||
    !Number.isFinite(preflight.viewportWidth) ||
    !Number.isFinite(preflight.viewportHeight)
  ) {
    throw new Error("DOM snapshot preflight returned invalid metadata");
  }
  if (preflight.nodeCount > limit) throw nodeLimitError(limit, preflight.nodeCount);
  if (preflight.characterCount > MAX_SNAPSHOT_CHARACTERS) {
    throw new Error(
      `Page text, attributes, and form values exceed ${MAX_SNAPSHOT_CHARACTERS.toLocaleString()} characters`
    );
  }

  const computedStyles = options.markViewport || options.markHidden
    ? SNAPSHOT_COMPUTED_STYLES
    : ["pointer-events"] as const;
  const value = await withTimeout(
    conn.client.send("DOMSnapshot.captureSnapshot", {
      computedStyles: [...computedStyles],
      includePaintOrder: false,
      includeDOMRects: false,
    }),
    remaining(),
    "captureDOMSnapshot:capture"
  );
  return decodeDOMSnapshot(value, {
    viewportWidth: preflight.viewportWidth,
    viewportHeight: preflight.viewportHeight,
    markViewport: options.markViewport,
    markHidden: options.markHidden,
    maxNodes: limit,
    computedStyles,
  });
}
