const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
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

/**
 * Compress a URL for token-efficient output.
 *
 * 1. Strip tracking params
 * 2. Relativize same-origin URLs
 * 3. Drop protocol
 * 4. Truncate long paths (>4 segments)
 * 5. Graceful passthrough for special schemes
 */
export function compressUrl(href: string, pageUrl?: string): string {
  // Passthrough for special schemes
  if (
    href.startsWith("javascript:") ||
    href.startsWith("#") ||
    href.startsWith("blob:") ||
    href.startsWith("data:")
  ) {
    return href;
  }

  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return href;
  }

  // 1. Strip tracking params
  for (const param of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(param) || param.startsWith("utm_")) {
      url.searchParams.delete(param);
    }
  }

  // 2. Relativize same-origin
  let pageOrigin: string | undefined;
  if (pageUrl) {
    try {
      pageOrigin = new URL(pageUrl).origin;
    } catch {
      // ignore
    }
  }

  const sameOrigin = pageOrigin && url.origin === pageOrigin;

  // Build path + query + hash
  const search = url.search;
  const hash = url.hash;
  let path = url.pathname;

  // 4. Path truncation: if > 4 segments, keep first 2 + last 1
  const segments = path.split("/").filter(Boolean);
  if (segments.length > 4) {
    const truncated = [segments[0], segments[1], "...", segments[segments.length - 1]];
    path = "/" + truncated.join("/");
  }

  if (sameOrigin) {
    return path + search + hash;
  }

  // 3. Drop protocol
  const host = url.host;
  return host + path + search + hash;
}
