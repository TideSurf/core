import type { OSNode } from "../types.js";
import { escapeHtml } from "./serializer.js";
import { graphemeCount, truncateGraphemes } from "./truncation.js";

const MAX_FILTER_DEPTH = 500;
const SUMMARY_TEXT_LIMIT = 100;
const INTERACTIVE_LABELS = [
  ["links", "link"],
  ["buttons", "button"],
  ["inputs", "input"],
  ["selects", "select"],
  ["interactive", "interactive"],
] as const;

interface InteractiveCounts {
  [key: string]: number;
  links: number;
  buttons: number;
  inputs: number;
  selects: number;
  interactive: number;
}

function emptyCounts(): InteractiveCounts {
  return { links: 0, buttons: 0, inputs: 0, selects: 0, interactive: 0 };
}

const EMPTY_COUNTS: InteractiveCounts = emptyCounts();

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

interface TextSummary {
  value: string;
  count?: number;
}

const EMPTY_TEXT: TextSummary = { value: "", count: 0 };

function summarizeText(text: string | undefined, limit: number): TextSummary {
  const value = truncateGraphemes(text ?? "", limit);
  return { value, count: value ? undefined : 0 };
}

function appendText(
  current: TextSummary,
  next: TextSummary,
  limit: number
): void {
  if (!next.value) return;
  const currentCount = current.count ?? graphemeCount(current.value, limit);
  current.count = currentCount;
  if (currentCount >= limit) return;
  const separator = current.value.length > 0 ? " " : "";
  const separatorSize = separator ? 1 : 0;
  const remaining = limit - currentCount - separatorSize;
  if (remaining <= 0) return;
  const appended = truncateGraphemes(next.value, remaining);
  current.value += separator + appended;
  if (appended !== next.value) {
    current.count = limit;
  } else if (next.count !== undefined) {
    current.count = currentCount + separatorSize + next.count;
  } else {
    current.count = undefined;
  }
}

function isFull(text: TextSummary, limit: number): boolean {
  text.count ??= graphemeCount(text.value, limit);
  return text.count >= limit;
}

interface InteractiveResult {
  node?: OSNode;
  text: TextSummary;
}

function filterInteractiveNode(node: OSNode, depth: number): InteractiveResult {
  if (depth > MAX_FILTER_DEPTH) return { text: EMPTY_TEXT };
  if (node.tag === "#text") {
    return { text: summarizeText(node.text, SUMMARY_TEXT_LIMIT) };
  }

  const children: OSNode[] = [];
  const label = summarizeText(node.text, SUMMARY_TEXT_LIMIT);
  for (const child of node.children) {
    const filtered = filterInteractiveNode(child, depth + 1);
    appendText(label, filtered.text, SUMMARY_TEXT_LIMIT);
    if (filtered.node) children.push(filtered.node);
  }

  if (node.id) {
    const labelNode = label.value
      ? [{ tag: "#text", attributes: {}, children: [], text: label.value } satisfies OSNode]
      : [];
    return {
      node: { ...node, children: [...labelNode, ...children], text: undefined },
      text: EMPTY_TEXT,
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
export function filterInteractive(nodes: OSNode[]): OSNode[] {
  const result: OSNode[] = [];
  for (const node of nodes) {
    const filtered = filterInteractiveNode(node, 0).node;
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

export function summarizeOffscreenNode(
  node: OSNode,
  textLimit: number
): { counts: Record<string, number>; text: string } {
  const counts = emptyCounts();
  const text = summarizeText(node.text, textLimit);

  const visit = (current: OSNode, depth: number): void => {
    if (depth > MAX_FILTER_DEPTH) return;
    addInteractiveId(counts, current.id);
    if (!isFull(text, textLimit)) {
      appendText(text, summarizeText(current.text, textLimit), textLimit);
    }
    for (const child of current.children) visit(child, depth + 1);
  };

  for (const child of node.children) visit(child, 0);
  // Compose and truncate raw graphemes first, then escape page text once.
  return { counts, text: escapeHtml(text.value) };
}

export function interactiveSummary(counts: Record<string, number>): string {
  if (
    (counts["links"] ?? 0) +
      (counts["buttons"] ?? 0) +
      (counts["inputs"] ?? 0) +
      (counts["selects"] ?? 0) +
      (counts["interactive"] ?? 0) ===
    0
  ) {
    return "";
  }
  const parts: string[] = [];
  for (const [label, singular] of INTERACTIVE_LABELS) {
    const count = counts[label] ?? 0;
    if (count > 0) {
      parts.push(`${count} ${count === 1 ? singular : label}`);
    }
  }
  return `[${parts.join(", ")}]`;
}

interface MinimalResult {
  counts: InteractiveCounts;
  text: TextSummary;
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
    return { counts: EMPTY_COUNTS, text: EMPTY_TEXT };
  }

  let counts: InteractiveCounts | undefined;
  if (node.id) {
    counts = emptyCounts();
    addInteractiveId(counts, node.id);
  }
  const isLandmark = LANDMARK_TAGS.has(node.tag);
  const text = summarizeText(node.text, SUMMARY_TEXT_LIMIT);
  let childCounts: InteractiveCounts | undefined;
  let childLandmarks: LandmarkList | undefined;

  for (const child of node.children) {
    const result = summarizeMinimal(child, depth + 1);
    if (result.counts !== EMPTY_COUNTS) {
      mergeCounts(counts ??= emptyCounts(), result.counts);
      if (isLandmark) mergeCounts(childCounts ??= emptyCounts(), result.counts);
    }
    appendText(text, result.text, SUMMARY_TEXT_LIMIT);
    childLandmarks = appendLandmarks(childLandmarks, result.landmarks);
  }

  if (!isLandmark) {
    return { counts: counts ?? EMPTY_COUNTS, text, landmarks: childLandmarks };
  }

  const countSummary = interactiveSummary(childCounts ?? EMPTY_COUNTS);
  // Escaping before appendText would count `&amp;` and `\\[` as multiple raw
  // graphemes and could truncate inside an escape. Escape exactly once after
  // the raw summary has reached its grapheme boundary.
  const escapedText = escapeHtml(text.value.trim());
  const summary = escapedText && countSummary
    ? `${escapedText} ${countSummary}`
    : escapedText || countSummary;
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
  return { counts: EMPTY_COUNTS, text: EMPTY_TEXT, landmarks };
}

/** Summarize landmarks in one post-order traversal. */
export function filterMinimal(nodes: OSNode[]): OSNode[] {
  const result: OSNode[] = [];
  for (const node of nodes) {
    let link = summarizeMinimal(node, 0).landmarks?.head;
    while (link) {
      result.push(link.node);
      link = link.next;
    }
  }
  return result;
}
