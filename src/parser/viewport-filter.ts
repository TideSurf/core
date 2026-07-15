import type { OSNode } from "../types.js";
import {
  collectTextBounded,
  countInteractiveChildren,
  interactiveSummary,
} from "./mode-filter.js";

export interface ViewportFilterResult {
  nodes: OSNode[];
  aboveSummary?: OSNode;
  belowSummary?: OSNode;
}

const MAX_FILTER_DEPTH = 500;
const SUMMARY_NODE_LIMIT = 5;
const SUMMARY_TEXT_LIMIT = 50;

function summarizeRegion(nodes: OSNode[], tag: "above" | "below"): OSNode | undefined {
  const parts: string[] = [];
  let sectionCount = 0;

  for (const node of nodes) {
    if (node.tag === "#text") continue;
    sectionCount++;
    if (parts.length >= SUMMARY_NODE_LIMIT) continue;

    const countSummary = interactiveSummary(countInteractiveChildren(node));
    const text = collectTextBounded(node, SUMMARY_TEXT_LIMIT).trim();
    let description = node.tag;
    if (text) description += `: ${text}`;
    if (countSummary) description += ` ${countSummary}`;
    parts.push(description);
  }

  if (parts.length === 0) return undefined;
  const omitted = sectionCount - parts.length;
  return {
    tag,
    attributes: {},
    children: [],
    text: `${parts.join(", ")}${omitted > 0 ? `, ...${omitted} more` : ""}`,
  };
}

function filterNode(
  node: OSNode,
  parentVisible: boolean,
  depth: number
): OSNode | undefined {
  if (depth > MAX_FILTER_DEPTH) return undefined;
  if (node.tag === "#text") {
    if (node.visible === false) return undefined;
    return parentVisible || node.visible ? node : undefined;
  }

  const selfVisible = node.visible === true;
  const children: OSNode[] = [];
  let childrenChanged = false;

  for (const child of node.children) {
    const filtered = filterNode(child, selfVisible, depth + 1);
    if (filtered) children.push(filtered);
    if (filtered !== child) childrenChanged = true;
  }

  if (!selfVisible && children.length === 0) return undefined;
  if (!childrenChanged && children.length === node.children.length) return node;

  return {
    tag: node.tag,
    id: node.id,
    attributes: node.attributes,
    children,
    text: selfVisible ? node.text : undefined,
    visible: node.visible,
    state: node.state,
  };
}

/** Keep visible elements, their direct text, and the ancestor paths that reach them. */
export function filterViewportOnly(nodes: OSNode[]): ViewportFilterResult {
  const filteredByIndex = nodes.map((node) => filterNode(node, false, 0));
  let firstVisibleIndex = -1;
  let lastVisibleIndex = -1;

  for (let index = 0; index < filteredByIndex.length; index++) {
    if (!filteredByIndex[index]) continue;
    if (firstVisibleIndex === -1) firstVisibleIndex = index;
    lastVisibleIndex = index;
  }

  if (firstVisibleIndex === -1) return { nodes: [] };

  const filtered: OSNode[] = [];
  for (let index = firstVisibleIndex; index <= lastVisibleIndex; index++) {
    const node = filteredByIndex[index];
    if (node) filtered.push(node);
  }

  return {
    nodes: filtered,
    aboveSummary: summarizeRegion(nodes.slice(0, firstVisibleIndex), "above"),
    belowSummary: summarizeRegion(nodes.slice(lastVisibleIndex + 1), "below"),
  };
}
