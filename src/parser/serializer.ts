import type { OSNode, ScrollPosition } from "../types.js";
import {
  compressUrl,
  compressUrlWithContext,
  createUrlCompressionContext,
  escapeUrlMarkers,
  percentEncodeUnsafeControls,
  type UrlCompressionContext,
} from "./url-compressor.js";
import { formatTruncation, truncateGraphemes } from "./truncation.js";

function escapeQuotes(text: string): string {
  // Escape page-provided backslashes before adding structural escapes. An odd
  // escape parity then remains odd even when the source already contains `\\`.
  const escapedBackslashes = text.replaceAll("\\", "\\\\");
  return percentEncodeUnsafeControls(escapedBackslashes)
    .replace(/["\[\]]/g, (char) => `\\${char}`);
}

export function escapeHtml(text: string): string {
  // Backslashes must be doubled before marker escapes are introduced, or a
  // source `\\[B1]` can turn the generated bracket escape into even parity.
  const escapedBackslashes = text.replaceAll("\\", "\\\\");
  const safeText = percentEncodeUnsafeControls(escapedBackslashes);
  let result = "";
  let chunkStart = 0;
  for (let index = 0; index < safeText.length; index++) {
    let replacement: string | undefined;
    const code = safeText.charCodeAt(index);
    if (code === 38) replacement = "&amp;";
    else if (code === 60) replacement = "&lt;";
    else if (code === 62) replacement = "&gt;";
    else if (code === 34) replacement = "&quot;";
    // Square brackets are escaped so page-controlled text can never forge
    // element markers like [B1] in the serialized output.
    else if (code === 91) replacement = "\\[";
    else if (code === 93) replacement = "\\]";
    if (!replacement) continue;
    result += safeText.slice(chunkStart, index) + replacement;
    chunkStart = index + 1;
  }
  return chunkStart === 0 ? safeText : result + safeText.slice(chunkStart);
}

function pushIfNotEmpty(parts: string[], value: string): void {
  if (value.length > 0) parts.push(value);
}

function serializableText(node: OSNode): string | undefined {
  if (node.tag === "truncated") {
    return node.text ?? formatTruncation(node.attributes["count"] ?? "?");
  }
  return node.text;
}

interface ElementState {
  struck: boolean;
  flags: string;
}

interface SerializationContext {
  url: UrlCompressionContext;
  text: Map<OSNode, { all: string; nonInteractive: string }>;
}

export const OBSCURED_FLAG = " obscured";
export const OPEN_FLAG = " open";
export const CLOSED_FLAG = " closed";
export const IFRAME_INACCESSIBLE_PLACEHOLDER = "[iframe: inaccessible]";
export const IFRAME_UNKNOWN_PLACEHOLDER = "[iframe: unknown]";

/**
 * Compute element state for serialization.
 * Disabled/inert → struck through (~~). Obscured → keyword. Expanded/collapsed → open/closed.
 */
function getElementState(node: OSNode, hasAttrDisabled: boolean): ElementState {
  const isDisabled = hasAttrDisabled || node.state?.includes("disabled") === true;
  const isInert = node.state?.includes("inert") === true;
  const struck = isDisabled || isInert;

  let flags = "";
  if (!struck && node.state?.includes("obscured")) flags += OBSCURED_FLAG;
  if (node.attributes["aria-expanded"] === "true") flags += OPEN_FLAG;
  else if (node.attributes["aria-expanded"] === "false") flags += CLOSED_FLAG;
  return { struck, flags };
}

export const STRUCTURAL_CONTAINERS = new Set([
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

export const HEADING_MAP: Record<string, string> = {
  h1: "#",
  h2: "##",
  h3: "###",
  h4: "####",
  h5: "####",
  h6: "####",
  heading: "##",
};

function collectText(
  node: OSNode,
  context: SerializationContext
): { all: string; nonInteractive: string } {
  const cached = context.text.get(node);
  if (cached !== undefined) return cached;

  let result: { all: string; nonInteractive: string };
  if (node.tag === "#text") {
    const value = escapeHtml(node.text ?? "");
    result = { all: value, nonInteractive: value };
  } else {
    const text = serializableText(node);
    // The truncated marker is TideSurf-generated structural text, not page
    // text: it must keep its literal brackets.
    const ownText = text && node.tag !== "truncated" ? escapeHtml(text) : (text ?? "");
    if (node.children.length === 0) {
      result = { all: ownText, nonInteractive: ownText };
    } else if (node.children.length === 1) {
      const child = node.children[0];
      const childText = collectText(child, context);
      const all = childText.all
        ? ownText ? `${ownText} ${childText.all}` : childText.all
        : ownText;
      const retained = child.id ? "" : childText.nonInteractive;
      const nonInteractive = retained
        ? ownText ? `${ownText} ${retained}` : retained
        : ownText;
      result = { all, nonInteractive };
    } else {
      const all: string[] = [];
      let nonInteractive: string[] | undefined;
      if (ownText) all.push(ownText);
      for (const child of node.children) {
        const childText = collectText(child, context);
        if (!childText.all) continue;
        const retained = child.id ? "" : childText.nonInteractive;
        if (!nonInteractive && childText.all !== retained) {
          nonInteractive = all.slice();
        }
        all.push(childText.all);
        if (nonInteractive && retained) nonInteractive.push(retained);
      }
      const allText = all.join(" ");
      result = {
        all: allText,
        nonInteractive: nonInteractive?.join(" ") ?? allText,
      };
    }
  }

  context.text.set(node, result);
  return result;
}

function collectTextMemoized(node: OSNode, context: SerializationContext): string {
  return collectText(node, context).all;
}

function appendAction(
  parts: string[],
  node: OSNode,
  line: string,
  struck: boolean,
  indent: number,
  context: SerializationContext
): void {
  const pad = "  ".repeat(indent);
  parts.push(struck ? `${pad}~~${line.trim()}~~` : `${pad}${line}`);
  let mayContainAction = false;
  for (const child of node.children) {
    if (child.id || child.children.length > 0) {
      mayContainAction = true;
      break;
    }
  }
  if (!mayContainAction) return;
  const nestedActions = collectInteractiveDescendants(node);
  if (nestedActions.length > 0) {
    pushIfNotEmpty(parts, serializeNodes(nestedActions, indent + 1, context));
  }
}

export function serialize(nodes: OSNode[], indent: number = 0, pageUrl?: string): string {
  return serializeNodes(nodes, indent, {
    url: createUrlCompressionContext(pageUrl),
    text: new Map(),
  });
}

function serializeNodes(
  nodes: OSNode[],
  indent: number,
  context: SerializationContext
): string {
  const parts: string[] = [];
  const pad = "  ".repeat(indent);

  for (const node of nodes) {
    if (node.tag === "#text") {
      if (node.text?.trim()) {
        parts.push(`${pad}${escapeHtml(node.text)}`);
      }
      continue;
    }

    const headingPrefix = HEADING_MAP[node.tag];
    if (headingPrefix) {
      const content = serializeHeadingContent(node, context);
      if (content) {
        parts.push(`${pad}${headingPrefix} ${content}`);
      }
      continue;
    }

    if (node.tag === "link") {
      const id = node.id ?? "";
      const href = node.attributes["href"];
      const fallback = node.attributes["aria-label"] || node.attributes["title"] || "";
      const text = collectNonInteractiveText(node, context).trim() || escapeHtml(fallback);
      const compHref = href
        ? compressUrlWithContext(href, context.url)
        : undefined;
      const newTab = node.attributes["target"] === "_blank" ? " →" : "";
      const { struck, flags } = getElementState(node, node.attributes["aria-disabled"] === "true");
      let line: string;
      if (compHref) {
        line = `[${id}](${escapeUrlMarkers(compHref)}${newTab})${text ? " " + text : ""}${flags}`;
      } else {
        line = `[${id}]${text ? " " + text : ""}${flags}`;
      }
      appendAction(parts, node, line, struck, indent, context);
      continue;
    }

    if (node.tag === "button") {
      const id = node.id ?? "";
      const fallback = node.attributes["aria-label"] || node.attributes["title"] || "";
      const text = collectNonInteractiveText(node, context).trim() || escapeHtml(fallback);
      const { struck, flags } = getElementState(node, node.attributes["disabled"] !== undefined || node.attributes["aria-disabled"] === "true");
      const line = `[${id}]${text ? " " + text : ""}${flags}`;
      appendAction(parts, node, line, struck, indent, context);
      continue;
    }

    if (node.tag === "input") {
      const id = node.id ?? "";
      const type = node.attributes["type"];
      const placeholder = node.attributes["placeholder"];
      const value = node.attributes["value"];
      const readonly = node.attributes["readonly"] !== undefined ? " readonly" : "";
      const required = node.attributes["required"] !== undefined ? " required" : "";
      const checked = node.attributes["checked"] !== undefined ? " checked" : "";
      const min = node.attributes["min"] !== undefined ? ` min=${escapeQuotes(node.attributes["min"])}` : "";
      const max = node.attributes["max"] !== undefined ? ` max=${escapeQuotes(node.attributes["max"])}` : "";
      const step = node.attributes["step"] !== undefined ? ` step=${escapeQuotes(node.attributes["step"])}` : "";
      const pattern = node.attributes["pattern"] !== undefined ? ` pattern=${escapeQuotes(node.attributes["pattern"])}` : "";
      const { struck, flags } = getElementState(node, node.attributes["disabled"] !== undefined || node.attributes["aria-disabled"] === "true");

      let line = id;
      if (type && type !== "text") line += `:${escapeQuotes(type)}`;
      if (placeholder) line += ` ~${escapeQuotes(placeholder)}`;
      if (value) line += ` ="${escapeQuotes(value)}"`;
      line += min + max + step + pattern + flags + readonly + required + checked;
      parts.push(struck ? `${pad}~~${line.trim()}~~` : `${pad}${line.trim()}`);
      continue;
    }

    if (node.tag === "select") {
      const id = node.id ?? "";
      const { struck, flags: stateFlags } = getElementState(node, node.attributes["disabled"] !== undefined || node.attributes["aria-disabled"] === "true");
      let flags = stateFlags;
      if (node.attributes["required"] !== undefined) flags += " required";
      if (node.attributes["multiple"] !== undefined) flags += " multiple";
      const header = `${id}:select${flags}`;
      parts.push(struck ? `${pad}~~${header.trim()}~~` : `${pad}${header}`);
      if (node.children.length > 0) {
        pushIfNotEmpty(
          parts,
          serializeSelectChildren(node.children, indent + 1, context)
        );
      }
      continue;
    }

    if (node.tag === "img") {
      const alt = node.attributes["alt"];
      parts.push(`${pad}${alt ? `[img: ${escapeHtml(alt)}]` : "[img]"}`);
      continue;
    }

    if (node.tag === "iframe") {
      if (node.children.length > 0) {
        const src = node.attributes["src"];
        parts.push(`${pad}[iframe: ${src ? escapeUrlMarkers(compressUrlWithContext(src, context.url)) : "inline"}]`);
        pushIfNotEmpty(
          parts,
          serializeNodes(node.children, indent + 1, context)
        );
      } else {
        const status = node.attributes["status"];
        if (status === "inaccessible") {
          parts.push(pad + IFRAME_INACCESSIBLE_PLACEHOLDER);
        } else {
          const src = node.attributes["src"];
          parts.push(
            src
              ? `${pad}[iframe: ${escapeUrlMarkers(compressUrlWithContext(src, context.url))}]`
              : pad + IFRAME_UNKNOWN_PLACEHOLDER
          );
        }
      }
      continue;
    }

    if (node.tag === "list") {
      for (const child of node.children) {
        if (child.tag === "item") {
          const itemText = serializeItem(child, context);
          parts.push(`${pad}- ${itemText}`);
        } else if (child.tag === "#text" && child.text?.trim()) {
          parts.push(`${pad}${escapeHtml(child.text)}`);
        } else {
          pushIfNotEmpty(parts, serializeNodes([child], indent, context));
        }
      }
      continue;
    }

    if (node.tag === "item") {
      const itemText = serializeItem(node, context);
      parts.push(`${pad}- ${itemText}`);
      continue;
    }

    if (node.tag === "row") {
      const cells = node.children
        .filter((c) => c.tag === "cell" || c.tag === "#text")
        .map((c) => collectNonInteractiveText(c, context).trim());
      parts.push(`${pad}| ${cells.join(" | ")} |`);
      const interactiveChildren = collectInteractiveRoots(node);
      if (interactiveChildren.length > 0) {
        pushIfNotEmpty(
          parts,
          serializeNodes(interactiveChildren, indent + 1, context)
        );
      }
      continue;
    }

    if (node.tag === "cell") {
      const text = collectNonInteractiveText(node, context).trim();
      if (text) parts.push(`${pad}${text}`);
      const interactiveChildren = collectInteractiveRoots(node);
      if (interactiveChildren.length > 0) {
        pushIfNotEmpty(
          parts,
          serializeNodes(interactiveChildren, indent + 1, context)
        );
      }
      continue;
    }

    if (node.tag === "label") {
      const text = collectNonInteractiveText(node, context).trim();
      if (text) {
        parts.push(`${pad}${text}:`);
      }
      const interactiveChildren = collectInteractiveRoots(node);
      if (interactiveChildren.length > 0) {
        pushIfNotEmpty(
          parts,
          serializeNodes(interactiveChildren, indent + 1, context)
        );
      }
      continue;
    }

    if (node.tag === "truncated") {
      parts.push(`${pad}${serializableText(node)}`);
      continue;
    }

    if (node.tag === "above" || node.tag === "below") {
      // Summary text is escaped at composition time (mode-filter); the
      // interactive-count markers it embeds are TideSurf-generated and keep
      // their literal brackets. The memoized fallback is already escaped.
      const text = node.text ?? collectTextMemoized(node, context).trim();
      parts.push(`${pad}${node.tag.toUpperCase()}: ${text}`);
      continue;
    }

    if (STRUCTURAL_CONTAINERS.has(node.tag)) {
      const label = node.tag.toUpperCase();
      const id = node.id ? ` ${node.id}` : "";
      const ariaLabel = node.attributes["aria-label"];
      // node.text here is a minimal-mode landmark summary: page text escaped
      // at composition time plus TideSurf-generated count markers.
      const summary = node.text?.trim();
      let description = ariaLabel ? escapeHtml(ariaLabel) : "";
      if (summary && summary !== ariaLabel) {
        description = description
          ? `${description} — ${summary}`
          : summary;
      }
      const desc = description ? `: ${description}` : "";
      parts.push(`${pad}${label}${id}${desc}`);
      if (node.children.length > 0) {
        pushIfNotEmpty(
          parts,
          serializeNodes(node.children, indent + 1, context)
        );
      }
      continue;
    }

    if (node.children.length > 0) {
      pushIfNotEmpty(parts, serializeNodes(node.children, indent, context));
    } else if (node.text) {
      parts.push(`${pad}${escapeHtml(node.text)}`);
    }
  }

  return parts.join("\n");
}

function serializeSelectChildren(
  nodes: OSNode[],
  indent: number,
  context: SerializationContext,
  inheritedDisabled: boolean = false
): string {
  const parts: string[] = [];
  const pad = "  ".repeat(indent);

  for (const node of nodes) {
    if (node.tag === "#text") {
      const text = node.text?.trim();
      if (text) {
        parts.push(`${pad}${escapeHtml(text)}`);
      }
      continue;
    }
    if (node.tag === "optgroup") {
      const label = node.attributes["aria-label"] || node.attributes["label"] || "";
      const disabled = inheritedDisabled || node.attributes["disabled"] !== undefined;
      if (label) {
        const escapedLabel = escapeHtml(label);
        parts.push(`${pad}${disabled ? `~~${escapedLabel}~~` : escapedLabel}:`);
      }
      if (node.children.length > 0) {
        pushIfNotEmpty(
          parts,
          serializeSelectChildren(node.children, indent + 1, context, disabled)
        );
      }
      continue;
    }
    const text = collectTextMemoized(node, context).trim();
    if (!text) continue;
    const isSelected = node.attributes["selected"] !== undefined || node.attributes["aria-selected"] === "true";
    const disabled = inheritedDisabled || node.attributes["disabled"] !== undefined;
    parts.push(`${pad}${isSelected ? "> " : ""}${disabled ? `~~${text}~~` : text}`);
  }

  return parts.join("\n");
}

function serializeItem(
  node: OSNode,
  context: SerializationContext
): string {
  if (node.children.length === 1 && node.children[0].tag === "#text") {
    const id = node.id ? `[${node.id}] ` : "";
    return `${id}${collectTextMemoized(node.children[0], context)}`;
  }

  const inlineParts: string[] = [];
  if (node.id) inlineParts.push(`[${node.id}]`);
  for (const child of node.children) {
    if (child.tag === "#text") {
      if (child.text?.trim()) inlineParts.push(escapeHtml(child.text));
    } else if (child.id) {
      const rendered = serializeNodes([child], 0, context)
        .replace(/\s*\n\s*/g, " ")
        .trim();
      if (rendered) inlineParts.push(rendered);
    } else {
      const interactiveRoots = collectInteractiveRoots(child);
      if (interactiveRoots.length > 0) {
        const nested = serializeNodes(interactiveRoots, 0, context)
          .replace(/\s*\n\s*/g, " ")
          .trim();
        if (nested) inlineParts.push(nested);
      } else {
        const text = collectTextMemoized(child, context).trim();
        if (text) inlineParts.push(text);
      }
    }
  }
  return inlineParts.join(" ");
}

function collectInteractiveRoots(node: OSNode): OSNode[] {
  return node.id ? [node] : collectInteractiveDescendants(node);
}

function collectInteractiveDescendants(node: OSNode): OSNode[] {
  const result: OSNode[] = [];
  const stack = [...node.children].reverse();
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.id) {
      result.push(current);
      continue;
    }
    for (let index = current.children.length - 1; index >= 0; index--) {
      stack.push(current.children[index]);
    }
  }
  return result;
}

function serializeHeadingContent(
  node: OSNode,
  context: SerializationContext
): string {
  const parts: string[] = [];
  const text = serializableText(node);
  // #text nodes carry raw page text and need escaping. Element nodes only
  // carry text when a mode filter synthesized it (minimal-mode landmark
  // summaries), and that text is already escaped at composition time.
  if (text) parts.push(node.tag === "#text" ? escapeHtml(text) : text);

  for (const child of node.children) {
    if (child.id) {
      const rendered = serializeNodes([child], 0, context)
        .replace(/\s*\n\s*/g, " ")
        .trim();
      if (rendered) parts.push(rendered);
      continue;
    }

    const rendered = serializeHeadingContent(child, context);
    if (rendered) parts.push(rendered);
  }

  return parts.join(" ").trim();
}

function collectNonInteractiveText(
  node: OSNode,
  context: SerializationContext
): string {
  return collectText(node, context).nonInteractive;
}

function compressPageUrl(url: string): string {
  if (url.startsWith("data:")) {
    const commaIndex = url.indexOf(",");
    const header = commaIndex === -1 ? url : url.slice(0, commaIndex);
    return `${header},...`;
  }
  return compressUrl(url);
}

export interface PageHeaderFitOptions {
  /** Maximum additive budget units available to the header. */
  maxSize: number;
  /** Measure already-escaped output. Defaults to UTF-16 length. */
  measure?: (text: string) => number;
}

function fitEscapedGraphemes(
  raw: string,
  maxSize: number,
  escape: (text: string) => string,
  measure: (text: string) => number
): string {
  const escaped = escape(raw);
  if (measure(escaped) <= maxSize) return escaped;
  if (maxSize <= 0) return "";

  const fullSuffix = "...";
  const suffix = measure(fullSuffix) <= maxSize ? fullSuffix : "";
  const shortened = truncateGraphemes(raw, maxSize, {
    suffix,
    measure: (grapheme) => measure(escape(grapheme)),
    reservedSize: measure(suffix),
  });
  return escape(shortened);
}

/**
 * Build the page header lines (title + URL meta) that wrapPage prepends to
 * the serialized body. With a fit budget, page-controlled components are
 * truncated only at raw grapheme boundaries and then escaped exactly once.
 */
export function pageHeader(
  url: string,
  title: string,
  scrollPosition?: ScrollPosition,
  fit?: PageHeaderFitOptions
): string {
  // Collapse title whitespace before escaping so it cannot inject a line.
  const normalizedTitle = title.replace(/\s+/g, " ").trim();
  const compressedUrl = compressPageUrl(url);
  const safeTitle = escapeHtml(normalizedTitle);
  const safeUrl = escapeUrlMarkers(compressedUrl);
  const titlePrefix = "# ";
  const metaPrefix = "\n> ";
  let scrollSuffix = scrollPosition
    ? ` | ${scrollPosition.scrollY}/${scrollPosition.scrollHeight} ${scrollPosition.viewportHeight}vh`
    : "";

  if (!fit) {
    return `${titlePrefix}${safeTitle}${metaPrefix}${safeUrl}${scrollSuffix}`;
  }

  const maxSize = Number.isFinite(fit.maxSize)
    ? Math.max(0, fit.maxSize)
    : 0;
  const measure = fit.measure ?? ((text: string) => text.length);
  const scaffold = titlePrefix + metaPrefix;
  if (measure(scaffold) > maxSize) {
    return truncateGraphemes(scaffold, maxSize, { measure });
  }

  // Scroll metadata is generated rather than page-controlled. Omit it only
  // when the fixed header scaffold itself otherwise cannot fit.
  if (measure(scaffold) + measure(scrollSuffix) > maxSize) {
    scrollSuffix = "";
  }
  const fixedSize = measure(scaffold) + measure(scrollSuffix);
  if (
    fixedSize + measure(safeTitle) + measure(safeUrl) <=
    maxSize
  ) {
    return `${titlePrefix}${safeTitle}${metaPrefix}${safeUrl}${scrollSuffix}`;
  }

  // Preserve the URL while shrinking an oversized title first. If the URL is
  // itself too large, it receives the remaining budget and is then truncated.
  const fittedTitle = fitEscapedGraphemes(
    normalizedTitle,
    Math.max(0, maxSize - fixedSize - measure(safeUrl)),
    escapeHtml,
    measure
  );
  const fittedUrl = fitEscapedGraphemes(
    compressedUrl,
    Math.max(0, maxSize - fixedSize - measure(fittedTitle)),
    escapeUrlMarkers,
    measure
  );
  return `${titlePrefix}${fittedTitle}${metaPrefix}${fittedUrl}${scrollSuffix}`;
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
  return `${pageHeader(url, title, scrollPosition)}\n\n${body}`;
}
