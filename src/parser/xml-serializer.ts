import type { OSNode, ScrollPosition } from "../types.js";

/**
 * Escape XML special characters
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Serialize an array of OSNodes to XML string
 */
export function serializeToXml(nodes: OSNode[], indent: number = 0): string {
  const parts: string[] = [];
  const pad = "  ".repeat(indent);

  for (const node of nodes) {
    if (node.tag === "#text") {
      parts.push(`${pad}${escapeXml(node.text ?? "")}`);
      continue;
    }

    const attrStr = serializeAttributes(node.attributes);
    const opening = attrStr ? `${node.tag} ${attrStr}` : node.tag;

    // Self-closing tags (no children, no text)
    if (node.children.length === 0 && !node.text) {
      parts.push(`${pad}<${opening} />`);
      continue;
    }

    // Inline text-only nodes (no child elements)
    if (node.children.length === 0 && node.text) {
      parts.push(`${pad}<${opening}>${escapeXml(node.text)}</${node.tag}>`);
      continue;
    }

    // Text + children or just children
    if (
      node.children.length === 1 &&
      node.children[0].tag === "#text" &&
      !node.text
    ) {
      // Single text child — keep inline
      const text = escapeXml(node.children[0].text ?? "");
      parts.push(`${pad}<${opening}>${text}</${node.tag}>`);
      continue;
    }

    // Multi-child: use block formatting
    parts.push(`${pad}<${opening}>`);
    if (node.text) {
      parts.push(`${pad}  ${escapeXml(node.text)}`);
    }
    parts.push(serializeToXml(node.children, indent + 1));
    parts.push(`${pad}</${node.tag}>`);
  }

  return parts.filter((p) => p.length > 0).join("\n");
}

function serializeAttributes(attrs: Record<string, string>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(attrs)) {
    if (value === "") {
      parts.push(key);
    } else {
      parts.push(`${key}="${escapeXml(value)}"`);
    }
  }
  return parts.join(" ");
}

function summarizePageUrl(url: string, maxLength: number = 160): string {
  if (url.startsWith("data:")) {
    const commaIndex = url.indexOf(",");
    const header = commaIndex === -1 ? url : url.slice(0, commaIndex);
    const summarized = `${header},...`;
    return summarized.length <= maxLength
      ? summarized
      : `${summarized.slice(0, maxLength - 3)}...`;
  }

  if (url.length <= maxLength) {
    return url;
  }

  return `${url.slice(0, maxLength - 3)}...`;
}

/**
 * Wrap nodes in a <page> element with url and title.
 * When scrollPosition is provided, adds scroll-y, scroll-height, viewport-height attributes.
 */
export function wrapPage(
  xml: string,
  url: string,
  title: string,
  scrollPosition?: ScrollPosition
): string {
  const safeUrl = summarizePageUrl(url);
  let attrs = `url="${escapeXml(safeUrl)}" title="${escapeXml(title)}"`;
  if (scrollPosition) {
    attrs += ` scroll-y="${scrollPosition.scrollY}" scroll-height="${scrollPosition.scrollHeight}" viewport-height="${scrollPosition.viewportHeight}"`;
  }
  return `<page ${attrs}>\n${xml}\n</page>`;
}
