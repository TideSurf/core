import type { OSNode, ScrollPosition } from "../types.js";
import { compressUrl } from "./url-compressor.js";

/**
 * Container tags that get their own line and indented children.
 */
const STRUCTURAL_CONTAINERS = new Set([
  "form",
  "nav",
  "table",
  "main",
  "header",
  "footer",
  "section",
  "article",
  "aside",
  "dialog",
]);

const HEADING_MAP: Record<string, string> = {
  h1: "#",
  h2: "##",
  h3: "###",
  h4: "####",
  h5: "####",
  h6: "####",
  heading: "##",
};

/**
 * Collect all text from a node and its children.
 */
function collectText(node: OSNode): string {
  if (node.tag === "#text") return node.text ?? "";
  const parts: string[] = [];
  if (node.text) parts.push(node.text);
  for (const child of node.children) {
    const t = collectText(child);
    if (t) parts.push(t);
  }
  return parts.join(" ");
}

/**
 * Serialize an array of OSNodes to compact markdown-like text.
 */
export function serialize(nodes: OSNode[], indent: number = 0, pageUrl?: string): string {
  const parts: string[] = [];
  const pad = "  ".repeat(indent);

  for (const node of nodes) {
    if (node.tag === "#text") {
      if (node.text?.trim()) {
        parts.push(`${pad}${node.text}`);
      }
      continue;
    }

    // Headings: # text
    const headingPrefix = HEADING_MAP[node.tag];
    if (headingPrefix) {
      const text = collectText(node).trim();
      if (text) {
        parts.push(`${pad}${headingPrefix} ${text}`);
      }
      continue;
    }

    // Links: [ID](href) text
    if (node.tag === "link") {
      const id = node.id ?? "";
      const href = node.attributes["href"];
      const text = collectText(node).trim() || node.attributes["aria-label"] || node.attributes["title"] || "";
      const compHref = href ? compressUrl(href, pageUrl) : undefined;
      const newTab = node.attributes["target"] === "_blank" ? " →" : "";
      let flags = "";
      if (node.attributes["aria-disabled"] === "true") flags += " disabled";
      if (node.attributes["aria-expanded"] === "true") flags += " expanded";
      else if (node.attributes["aria-expanded"] === "false") flags += " collapsed";
      if (compHref) {
        parts.push(`${pad}[${id}](${compHref}${newTab})${text ? " " + text : ""}${flags}`);
      } else {
        parts.push(`${pad}[${id}]${text ? " " + text : ""}${flags}`);
      }
      continue;
    }

    // Buttons: [ID] text
    if (node.tag === "button") {
      const id = node.id ?? "";
      const text = collectText(node).trim() || node.attributes["aria-label"] || node.attributes["title"] || "";
      let flags = "";
      if (node.attributes["disabled"] !== undefined || node.attributes["aria-disabled"] === "true") flags += " disabled";
      if (node.attributes["aria-expanded"] === "true") flags += " expanded";
      else if (node.attributes["aria-expanded"] === "false") flags += " collapsed";
      parts.push(`${pad}[${id}]${text ? " " + text : ""}${flags}`);
      continue;
    }

    // Inputs: ID:subtype ~placeholder ="value"
    if (node.tag === "input") {
      const id = node.id ?? "";
      const type = node.attributes["type"];
      const placeholder = node.attributes["placeholder"];
      const value = node.attributes["value"];
      const disabled = node.attributes["disabled"] !== undefined || node.attributes["aria-disabled"] === "true" ? " disabled" : "";
      const readonly = node.attributes["readonly"] !== undefined ? " readonly" : "";
      const required = node.attributes["required"] !== undefined ? " required" : "";
      const checked = node.attributes["checked"] !== undefined ? " checked" : "";
      const min = node.attributes["min"] !== undefined ? ` min=${node.attributes["min"]}` : "";
      const max = node.attributes["max"] !== undefined ? ` max=${node.attributes["max"]}` : "";
      const step = node.attributes["step"] !== undefined ? ` step=${node.attributes["step"]}` : "";
      const pattern = node.attributes["pattern"] !== undefined ? ` pattern=${node.attributes["pattern"]}` : "";
      let expanded = "";
      if (node.attributes["aria-expanded"] === "true") expanded = " expanded";
      else if (node.attributes["aria-expanded"] === "false") expanded = " collapsed";

      let line = id;
      if (type && type !== "text") line += `:${type}`;
      if (placeholder) line += ` ~${placeholder}`;
      if (value) line += ` ="${value}"`;
      line += min + max + step + pattern + disabled + readonly + required + checked + expanded;
      parts.push(`${pad}${line.trim()}`);
      continue;
    }

    // Selects: ID:select with children
    if (node.tag === "select") {
      const id = node.id ?? "";
      let flags = "";
      if (node.attributes["disabled"] !== undefined || node.attributes["aria-disabled"] === "true") flags += " disabled";
      if (node.attributes["required"] !== undefined) flags += " required";
      if (node.attributes["multiple"] !== undefined) flags += " multiple";
      parts.push(`${pad}${id}:select${flags}`);
      if (node.children.length > 0) {
        parts.push(serializeSelectChildren(node.children, indent + 1, pageUrl));
      }
      continue;
    }

    // Images: [img: alt] or [img]
    if (node.tag === "img") {
      const alt = node.attributes["alt"];
      parts.push(`${pad}${alt ? `[img: ${alt}]` : "[img]"}`);
      continue;
    }

    // Iframes: [iframe: src] or [iframe: inaccessible]
    if (node.tag === "iframe") {
      if (node.children.length > 0) {
        // Same-origin iframe with content
        const src = node.attributes["src"];
        parts.push(`${pad}[iframe: ${src ? compressUrl(src, pageUrl) : "inline"}]`);
        parts.push(serialize(node.children, indent + 1, pageUrl));
      } else {
        const status = node.attributes["status"];
        if (status === "inaccessible") {
          parts.push(`${pad}[iframe: inaccessible]`);
        } else {
          const src = node.attributes["src"];
          parts.push(`${pad}[iframe: ${src ? compressUrl(src, pageUrl) : "unknown"}]`);
        }
      }
      continue;
    }

    // Lists
    if (node.tag === "list") {
      for (const child of node.children) {
        if (child.tag === "item") {
          const itemText = serializeItem(child, pageUrl);
          parts.push(`${pad}- ${itemText}`);
        } else if (child.tag === "#text" && child.text?.trim()) {
          parts.push(`${pad}${child.text}`);
        } else {
          parts.push(serialize([child], indent, pageUrl));
        }
      }
      continue;
    }

    // Items (standalone, outside a list context)
    if (node.tag === "item") {
      const itemText = serializeItem(node, pageUrl);
      parts.push(`${pad}- ${itemText}`);
      continue;
    }

    // Table rows
    if (node.tag === "row") {
      const cells = node.children
        .filter((c) => c.tag === "cell" || c.tag === "#text")
        .map((c) => collectText(c).trim());
      parts.push(`${pad}| ${cells.join(" | ")} |`);
      continue;
    }

    // Cells (standalone)
    if (node.tag === "cell") {
      parts.push(`${pad}${collectText(node).trim()}`);
      continue;
    }

    // Labels
    if (node.tag === "label") {
      const text = collectText(node).trim();
      if (text) {
        parts.push(`${pad}${text}:`);
      }
      continue;
    }

    // Truncated
    if (node.tag === "truncated") {
      const count = node.attributes["count"] ?? "?";
      parts.push(`${pad}[...${count} more sections truncated]`);
      continue;
    }

    // Above/below off-screen summaries
    if (node.tag === "above" || node.tag === "below") {
      const text = node.text ?? collectText(node).trim();
      parts.push(`${pad}${node.tag.toUpperCase()}: ${text}`);
      continue;
    }

    // Structural containers
    if (STRUCTURAL_CONTAINERS.has(node.tag)) {
      const label = node.tag.toUpperCase();
      const id = node.id ? ` ${node.id}` : "";
      const ariaLabel = node.attributes["aria-label"];
      const desc = ariaLabel ? `: ${ariaLabel}` : "";
      parts.push("");
      parts.push(`${pad}${label}${id}${desc}`);
      if (node.children.length > 0) {
        parts.push(serialize(node.children, indent + 1, pageUrl));
      }
      continue;
    }

    // Fallback: just serialize children
    if (node.children.length > 0) {
      parts.push(serialize(node.children, indent, pageUrl));
    } else if (node.text) {
      parts.push(`${pad}${node.text}`);
    }
  }

  return parts.filter((p) => p.length > 0).join("\n");
}

/**
 * Serialize children of a <select>, marking selected options with `>` prefix.
 */
function serializeSelectChildren(nodes: OSNode[], indent: number, pageUrl?: string): string {
  const parts: string[] = [];
  const pad = "  ".repeat(indent);

  for (const node of nodes) {
    if (node.tag === "#text") {
      const text = node.text?.trim();
      if (text) {
        parts.push(`${pad}${text}`);
      }
      continue;
    }
    if (node.tag === "optgroup") {
      const label = node.attributes["aria-label"] || collectText(node).trim();
      if (label) parts.push(`${pad}${label}:`);
      if (node.children.length > 0) {
        parts.push(serializeSelectChildren(node.children, indent + 1, pageUrl));
      }
      continue;
    }
    const text = collectText(node).trim();
    if (!text) continue;
    const isSelected = node.attributes["selected"] !== undefined || node.attributes["aria-selected"] === "true";
    parts.push(`${pad}${isSelected ? "> " : ""}${text}`);
  }

  return parts.filter((p) => p.length > 0).join("\n");
}

/**
 * Serialize a list item's content inline.
 */
function serializeItem(node: OSNode, pageUrl?: string): string {
  // Simple case: just text children
  if (node.children.length === 1 && node.children[0].tag === "#text") {
    const id = node.id ? `[${node.id}] ` : "";
    return `${id}${node.children[0].text ?? ""}`;
  }

  // Inline children
  const inlineParts: string[] = [];
  if (node.id) inlineParts.push(`[${node.id}]`);
  for (const child of node.children) {
    if (child.tag === "#text") {
      if (child.text?.trim()) inlineParts.push(child.text);
    } else if (child.tag === "link") {
      const href = child.attributes["href"];
      const text = collectText(child).trim() || child.attributes["aria-label"] || child.attributes["title"] || "";
      const compHref = href ? compressUrl(href, pageUrl) : undefined;
      const id = child.id ?? "";
      if (compHref) {
        inlineParts.push(`[${id}](${compHref})${text ? " " + text : ""}`);
      } else {
        inlineParts.push(`[${id}]${text ? " " + text : ""}`);
      }
    } else if (child.tag === "button") {
      const id = child.id ?? "";
      const text = collectText(child).trim() || child.attributes["aria-label"] || child.attributes["title"] || "";
      inlineParts.push(`[${id}]${text ? " " + text : ""}`);
    } else {
      const text = collectText(child).trim();
      if (text) inlineParts.push(text);
    }
  }
  return inlineParts.join(" ");
}

function compressPageUrl(url: string): string {
  if (url.startsWith("data:")) {
    const commaIndex = url.indexOf(",");
    const header = commaIndex === -1 ? url : url.slice(0, commaIndex);
    return `${header},...`;
  }
  return compressUrl(url);
}

/**
 * Wrap serialized body in a page header.
 * Format:
 *   # Page Title
 *   > compressed-url | y/scrollHeight vh
 *
 *   [body]
 */
export function wrapPage(
  body: string,
  url: string,
  title: string,
  scrollPosition?: ScrollPosition
): string {
  const lines: string[] = [];
  lines.push(`# ${title}`);

  const compUrl = compressPageUrl(url);
  let metaLine = `> ${compUrl}`;
  if (scrollPosition) {
    metaLine += ` | ${scrollPosition.scrollY}/${scrollPosition.scrollHeight} ${scrollPosition.viewportHeight}vh`;
  }
  lines.push(metaLine);
  lines.push("");
  lines.push(body);

  return lines.join("\n");
}
