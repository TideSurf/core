import type { OSNode } from "../types.js";
import { graphemeCount, truncateGraphemes } from "./truncation.js";

const MAX_FILTER_DEPTH = 500;
const SUMMARY_TEXT_LIMIT = 100;

interface InteractiveCounts {
  links: number;
  buttons: number;
  inputs: number;
  selects: number;
  interactive: number;
}

function emptyCounts(): InteractiveCounts {
  return { links: 0, buttons: 0, inputs: 0, selects: 0, interactive: 0 };
}

function addInteractiveId(counts: InteractiveCounts, id?: string): void {
  if (!id) return;
  if (id.startsWith("L")) counts.links++;
  else if (id.startsWith("B")) counts.buttons++;
  else if (id.startsWith("I")) counts.inputs++;
  else if (id.startsWith("S")) counts.selects++;
  else counts.interactive++;
}

function mergeCounts(target: InteractiveCounts, source: InteractiveCounts): void {
  target.links += source.links;
  target.buttons += source.buttons;
  target.inputs += source.inputs;
  target.selects += source.selects;
  target.interactive += source.interactive;
}

function toRecord(counts: InteractiveCounts): Record<string, number> {
  return {
    links: counts.links,
    buttons: counts.buttons,
    inputs: counts.inputs,
    selects: counts.selects,
    interactive: counts.interactive,
  };
}

interface InteractiveResult {
  node?: OSNode;
  text: string;
}

function filterInteractiveNode(node: OSNode, depth: number): InteractiveResult {
  if (depth > MAX_FILTER_DEPTH) return { text: "" };
  if (node.tag === "#text") {
    return { text: truncateGraphemes(node.text ?? "", SUMMARY_TEXT_LIMIT) };
  }

  const children: OSNode[] = [];
  let label = truncateGraphemes(node.text ?? "", SUMMARY_TEXT_LIMIT);
  for (const child of node.children) {
    const filtered = filterInteractiveNode(child, depth + 1);
    label = appendText(label, filtered.text, SUMMARY_TEXT_LIMIT);
    if (filtered.node) children.push(filtered.node);
  }

  if (node.id) {
    const labelNode = label
      ? [{ tag: "#text", attributes: {}, children: [], text: label } satisfies OSNode]
      : [];
    return {
      node: { ...node, children: [...labelNode, ...children], text: undefined },
      text: "",
    };
  }
  if (children.length === 0) return { text: label };

  return {
    node: {
      tag: node.tag,
      attributes: node.attributes,
      children,
      visible: node.visible,
      state: node.state,
    },
    text: label,
  };
}

/** Keep interactive nodes and only the ancestor structure needed to reach them. */
export function filterInteractive(nodes: OSNode[], depth: number = 0): OSNode[] {
  if (depth > MAX_FILTER_DEPTH) return [];
  const result: OSNode[] = [];
  for (const node of nodes) {
    const filtered = filterInteractiveNode(node, depth).node;
    if (filtered) result.push(filtered);
  }
  return result;
}

const LANDMARK_TAGS = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "heading",
  "nav",
  "section",
  "form",
  "main",
  "header",
  "footer",
  "article",
  "aside",
]);

/** Count interactive descendants without allocating a list of IDs. */
export function countInteractiveChildren(node: OSNode): Record<string, number> {
  const counts = emptyCounts();

  const visit = (current: OSNode, depth: number): void => {
    if (depth > MAX_FILTER_DEPTH) return;
    addInteractiveId(counts, current.id);
    for (const child of current.children) visit(child, depth + 1);
  };

  for (const child of node.children) visit(child, 0);
  return toRecord(counts);
}

function appendText(current: string, next: string | undefined, limit: number): string {
  if (!next) return current;
  const currentCount = graphemeCount(current, limit);
  if (currentCount >= limit) return current;
  const separator = current.length > 0 ? " " : "";
  const remaining = limit - currentCount - (separator ? 1 : 0);
  if (remaining <= 0) return current;
  return `${current}${separator}${truncateGraphemes(next, remaining)}`;
}

/** Collect at most `limit` graphemes, stopping before unrelated tail content. */
export function collectTextBounded(node: OSNode, limit: number): string {
  let text = "";

  const visit = (current: OSNode, depth: number): void => {
    if (
      depth > MAX_FILTER_DEPTH ||
      graphemeCount(text, limit) >= limit
    ) return;
    text = appendText(text, current.text, limit);
    for (const child of current.children) {
      visit(child, depth + 1);
      if (graphemeCount(text, limit) >= limit) break;
    }
  };

  visit(node, 0);
  return text;
}

export function interactiveSummary(counts: Record<string, number>): string {
  const parts: string[] = [];
  for (const label of ["links", "buttons", "inputs", "selects", "interactive"]) {
    const count = counts[label] ?? 0;
    if (count > 0) {
      parts.push(`${count} ${count === 1 ? label.replace(/s$/, "") : label}`);
    }
  }
  return parts.length > 0 ? `[${parts.join(", ")}]` : "";
}

interface MinimalResult {
  counts: InteractiveCounts;
  text: string;
  landmarks?: LandmarkList;
}

interface LandmarkLink {
  node: OSNode;
  next?: LandmarkLink;
}

interface LandmarkList {
  head: LandmarkLink;
  tail: LandmarkLink;
}

function appendLandmarks(
  current: LandmarkList | undefined,
  next: LandmarkList | undefined
): LandmarkList | undefined {
  if (!next) return current;
  if (!current) return next;
  current.tail.next = next.head;
  current.tail = next.tail;
  return current;
}

function summarizeMinimal(node: OSNode, depth: number): MinimalResult {
  if (depth > MAX_FILTER_DEPTH) {
    return { counts: emptyCounts(), text: "" };
  }

  const counts = emptyCounts();
  addInteractiveId(counts, node.id);
  let text = truncateGraphemes(node.text ?? "", SUMMARY_TEXT_LIMIT);
  const childCounts = emptyCounts();
  const isLandmark = LANDMARK_TAGS.has(node.tag);
  let childLandmarks: LandmarkList | undefined;

  for (const child of node.children) {
    const result = summarizeMinimal(child, depth + 1);
    mergeCounts(counts, result.counts);
    mergeCounts(childCounts, result.counts);
    text = appendText(text, result.text, SUMMARY_TEXT_LIMIT);
    childLandmarks = appendLandmarks(childLandmarks, result.landmarks);
  }

  if (!isLandmark) {
    return { counts, text, landmarks: childLandmarks };
  }

  const countSummary = interactiveSummary(toRecord(childCounts));
  const summary = [text.trim(), countSummary].filter(Boolean).join(" ");
  const landmark: LandmarkLink = {
    node: {
      tag: node.tag,
      attributes: node.attributes,
      children: [],
      text: summary || undefined,
    },
  };
  const landmarks = appendLandmarks(
    { head: landmark, tail: landmark },
    childLandmarks
  );

  // A nested landmark owns its summary. Do not repeat its text and counts in
  // every ancestor landmark.
  return { counts: emptyCounts(), text: "", landmarks };
}

/** Summarize landmarks in one post-order traversal. */
export function filterMinimal(nodes: OSNode[], depth: number = 0): OSNode[] {
  if (depth > MAX_FILTER_DEPTH) return [];
  const result: OSNode[] = [];
  for (const node of nodes) {
    let link = summarizeMinimal(node, depth).landmarks?.head;
    while (link) {
      result.push(link.node);
      link = link.next;
    }
  }
  return result;
}
