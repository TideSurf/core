const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "ref",
  "rlz",
  "_ga",
  "_gl",
  "_hsenc",
  "_hsmi",
  "mc_cid",
  "mc_eid",
]);

export interface UrlCompressionContext {
  pageUrl?: string;
  pageOrigin?: string;
  originResolved: boolean;
  cache: Map<string, string>;
}

/** Percent-encode characters that can create or obscure output lines. */
export function percentEncodeUnsafeControls(text: string): string {
  let result = "";
  let chunkStart = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    let replacement: string | undefined;
    if (code <= 0x1f || code === 0x7f) {
      replacement = `%${code.toString(16).toUpperCase().padStart(2, "0")}`;
    } else if (code === 0x85) {
      replacement = "%C2%85";
    } else if (code === 0x2028) {
      replacement = "%E2%80%A8";
    } else if (code === 0x2029) {
      replacement = "%E2%80%A9";
    }
    if (replacement === undefined) continue;
    result += text.slice(chunkStart, index) + replacement;
    chunkStart = index + 1;
  }
  return chunkStart === 0 ? text : result + text.slice(chunkStart);
}

/**
 * Compressed URLs are interpolated into `[id](url)`, `[iframe: url]`, and
 * page-header markers, but compression intentionally preserves structural
 * characters. Escape existing backslashes before adding our own escapes so
 * attacker-controlled slash parity cannot expose `[`, `]`, `(`, or `)`.
 */
export function escapeUrlMarkers(url: string): string {
  const escapedBackslashes = url.replaceAll("\\", "\\\\");
  return percentEncodeUnsafeControls(escapedBackslashes)
    .replaceAll(/[\[\]()]/g, (char) => `\\${char}`);
}

export function createUrlCompressionContext(
  pageUrl?: string
): UrlCompressionContext {
  return { pageUrl, originResolved: false, cache: new Map() };
}

/** Strip tracking parameters, relativize same-origin URLs, and shorten paths. */
export function compressUrl(href: string, pageUrl?: string): string {
  return compressUrlWithContext(href, createUrlCompressionContext(pageUrl));
}

export function compressUrlWithContext(
  href: string,
  context: UrlCompressionContext
): string {
  const first = href.charCodeAt(0) | 0x20;
  const opaqueProtocol =
    (first === 0x6a && href.slice(0, 11).toLowerCase() === "javascript:") ||
    (first === 0x62 && href.slice(0, 5).toLowerCase() === "blob:") ||
    (first === 0x64 && href.slice(0, 5).toLowerCase() === "data:");
  if (href.startsWith("#") || opaqueProtocol) {
    return href;
  }

  const cached = context.cache.get(href);
  if (cached !== undefined) return cached;
  const compressed = compressParsedUrl(href, context);
  context.cache.set(href, compressed);
  return compressed;
}

/**
 * Remove tracking parameters from a raw query string without touching the
 * encoding of the remaining parameters. Unlike URLSearchParams.delete (which
 * re-serializes every pair through the form-urlencoded serializer — turning
 * %20 into +, / into %2F, and bare flags into flag=), this filters the raw
 * pairs textually so untouched params stay byte-identical.
 */
function stripTrackingParams(search: string): string {
  if (search.length <= 1) return search;
  const parts = search.slice(1).split("&");
  const kept: string[] = [];
  let removed = false;
  for (const part of parts) {
    const equals = part.indexOf("=");
    const name = equals === -1 ? part : part.slice(0, equals);
    if (TRACKING_PARAMS.has(name) || name.startsWith("utm_")) {
      removed = true;
      continue;
    }
    kept.push(part);
  }
  if (!removed) return search;
  return kept.length === 0 ? "" : `?${kept.join("&")}`;
}

function compressParsedUrl(
  href: string,
  context: UrlCompressionContext
): string {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return href;
  }

  if (!context.originResolved) {
    context.originResolved = true;
    try {
      context.pageOrigin = context.pageUrl
        ? new URL(context.pageUrl).origin
        : undefined;
    } catch {
      context.pageOrigin = undefined;
    }
  }
  const sameOrigin = context.pageOrigin !== undefined &&
    url.origin === context.pageOrigin;

  const search = stripTrackingParams(url.search);
  const hash = url.hash;
  let path = url.pathname;

  let segmentCount = 0;
  let insideSegment = false;
  for (let index = 0; index < path.length; index++) {
    if (path.charCodeAt(index) === 47) {
      insideSegment = false;
    } else if (!insideSegment) {
      insideSegment = true;
      segmentCount++;
      if (segmentCount > 4) break;
    }
  }
  if (segmentCount > 4) {
    const segments = path.split("/").filter(Boolean);
    const truncated = [segments[0], segments[1], "...", segments[segments.length - 1]];
    path = "/" + truncated.join("/");
  }

  if (sameOrigin) {
    return path + search + hash;
  }

  const host = url.host;
  return host + path + search + hash;
}
