import type { ClassifyResult } from "../types.js";

const DISCARD_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "LINK",
  "META",
  "NOSCRIPT",
  "TEMPLATE",
  "SVG",
  "HEAD",
  "BR",
]);

const KEEP_TAG_MAP: Record<string, string> = {
  A: "link",
  BUTTON: "button",
  INPUT: "input",
  SELECT: "select",
  TEXTAREA: "input",
  FORM: "form",
  NAV: "nav",
  TABLE: "table",
  TR: "row",
  "TD": "cell",
  TH: "cell",
  IMG: "img",
  H1: "h1",
  H2: "h2",
  H3: "h3",
  H4: "h4",
  H5: "h5",
  H6: "h6",
  UL: "list",
  OL: "list",
  LI: "item",
  LABEL: "label",
  DIALOG: "dialog",
  IFRAME: "iframe",
  MAIN: "main",
  OPTION: "option",
  OPTGROUP: "optgroup",
};

const INTERACTIVE_TAGS = new Set(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA"]);

const ROLE_TAG_MAP: Record<string, string> = {
  button: "button",
  navigation: "nav",
  link: "link",
  textbox: "input",
  listbox: "select",
  dialog: "dialog",
  heading: "heading",
  list: "list",
  listitem: "item",
  table: "table",
  row: "row",
  cell: "cell",
};

/**
 * Parse a flat attribute array ["key","value","key","value"] into a Record
 */
export function parseAttributes(attrs?: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  if (!attrs) return result;
  for (let i = 0; i < attrs.length; i += 2) {
    result[attrs[i]] = attrs[i + 1];
  }
  return result;
}

/**
 * Classify a DOM element into KEEP, COLLAPSE, or DISCARD
 */
export function classify(
  nodeName: string,
  attributes?: Record<string, string>,
  _children?: { nodeName: string; attributes?: string[] }[]
): ClassifyResult {
  const upper = nodeName.toUpperCase();

  // aria-hidden elements are discarded
  if (attributes?.["aria-hidden"] === "true") {
    return { action: "DISCARD" };
  }

  // hidden attribute
  if (attributes?.["hidden"] !== undefined) {
    return { action: "DISCARD" };
  }

  // display:none or visibility:hidden in style
  if (attributes?.["style"]) {
    const style = attributes["style"];
    // Use proper regex to handle various whitespace combinations
    if (/display\s*:\s*none\b/i.test(style)) {
      return { action: "DISCARD" };
    }
    if (/visibility\s*:\s*hidden\b/i.test(style)) {
      return { action: "DISCARD" };
    }
  }

  // Discard tags
  if (DISCARD_TAGS.has(upper)) {
    return { action: "DISCARD" };
  }

  // Role-based classification takes priority for generic elements
  if (attributes?.["role"]) {
    const mapped = ROLE_TAG_MAP[attributes["role"]];
    if (mapped) {
      return { action: "KEEP", mappedTag: mapped };
    }
  }

  // Conditional structural tags: KEEP only when semantically meaningful
  if (upper === "SECTION" || upper === "ARTICLE" || upper === "ASIDE") {
    if (attributes?.["aria-label"] || attributes?.["role"]) {
      return { action: "KEEP", mappedTag: upper.toLowerCase() };
    }
    return { action: "COLLAPSE" };
  }

  if (upper === "HEADER" || upper === "FOOTER") {
    const hasInteractiveChild = _children?.some((c) =>
      INTERACTIVE_TAGS.has(c.nodeName.toUpperCase())
    );
    if (hasInteractiveChild) {
      return { action: "KEEP", mappedTag: upper.toLowerCase() };
    }
    return { action: "COLLAPSE" };
  }

  // Keep tags
  if (KEEP_TAG_MAP[upper]) {
    return { action: "KEEP", mappedTag: KEEP_TAG_MAP[upper] };
  }

  // Everything else: COLLAPSE (promote children)
  return { action: "COLLAPSE" };
}

/**
 * Check if computed state includes a specific flag
 */
export function hasComputedState(state: string[] | undefined, flag: string): boolean {
  return state?.includes(flag) ?? false;
}

