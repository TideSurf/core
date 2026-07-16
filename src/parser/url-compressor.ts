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

  if (url.search.length > 1) {
    for (const param of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(param) || param.startsWith("utm_")) {
        url.searchParams.delete(param);
      }
    }
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

  const search = url.search;
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
