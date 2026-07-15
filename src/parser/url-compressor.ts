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

/** Strip tracking parameters, relativize same-origin URLs, and shorten paths. */
export function compressUrl(href: string, pageUrl?: string): string {
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

  for (const param of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(param) || param.startsWith("utm_")) {
      url.searchParams.delete(param);
    }
  }

  const pageOrigin = pageUrl ? new URL(pageUrl).origin : undefined;
  const sameOrigin = pageOrigin !== undefined && url.origin === pageOrigin;

  const search = url.search;
  const hash = url.hash;
  let path = url.pathname;

  const segments = path.split("/").filter(Boolean);
  if (segments.length > 4) {
    const truncated = [segments[0], segments[1], "...", segments[segments.length - 1]];
    path = "/" + truncated.join("/");
  }

  if (sameOrigin) {
    return path + search + hash;
  }

  const host = url.host;
  return host + path + search + hash;
}
