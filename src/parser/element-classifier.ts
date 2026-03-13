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
  H1: "heading",
  H2: "heading",
  H3: "heading",
  H4: "heading",
  H5: "heading",
  H6: "heading",
  UL: "list",
  OL: "list",
  LI: "item",
  LABEL: "label",
  DIALOG: "dialog",
  IFRAME: "iframe",
};

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

const SECTION_TAGS = new Set(["SECTION", "ARTICLE", "MAIN", "HEADER", "FOOTER", "ASIDE"]);

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
 * Check if a node has interactive descendants (for SECTION_TAGS promotion)
 */
export function hasInteractiveContent(children?: { nodeName: string; attributes?: string[] }[]): boolean {
  if (!children) return false;
  for (const child of children) {
    const upper = child.nodeName.toUpperCase();
    if (KEEP_TAG_MAP[upper]) return true;
    const attrs = parseAttributes(child.attributes as string[] | undefined);
    if (attrs["role"] && ROLE_TAG_MAP[attrs["role"]]) return true;
  }
  return false;
}

/**
 * Classify a DOM element into KEEP, COLLAPSE, or DISCARD
 */
export function classify(
  nodeName: string,
  attributes?: Record<string, string>,
  children?: { nodeName: string; attributes?: string[] }[]
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
    const style = attributes["style"].toLowerCase();
    if (style.includes("display:none") || style.includes("display: none")) {
      return { action: "DISCARD" };
    }
    if (style.includes("visibility:hidden") || style.includes("visibility: hidden")) {
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

  // Keep tags
  if (KEEP_TAG_MAP[upper]) {
    return { action: "KEEP", mappedTag: KEEP_TAG_MAP[upper] };
  }

  // Section tags with interactive content → KEEP as "section"
  if (SECTION_TAGS.has(upper) && hasInteractiveContent(children)) {
    return { action: "KEEP", mappedTag: "section" };
  }

  // Everything else: COLLAPSE (promote children)
  return { action: "COLLAPSE" };
}
