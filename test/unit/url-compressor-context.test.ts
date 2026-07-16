import {
  compressUrl,
  compressUrlWithContext,
  createUrlCompressionContext,
} from "../../src/parser/url-compressor.js";

describe("compressUrlWithContext", () => {
  it("skips origin relativization when the page URL is unparseable", () => {
    const context = createUrlCompressionContext("example.com/page");

    expect(compressUrlWithContext("https://example.com/about", context)).toBe(
      "example.com/about"
    );
    expect(
      compressUrlWithContext("https://other.com/x?utm_source=a&id=1", context)
    ).toBe("other.com/x?id=1");
  });

  it("relativizes same-origin hrefs for a parseable page URL", () => {
    const context = createUrlCompressionContext("https://example.com/home");

    expect(compressUrlWithContext("https://example.com/about", context)).toBe(
      "/about"
    );
  });

  it("memoizes compressed hrefs per context", () => {
    const context = createUrlCompressionContext("https://example.com/home");

    compressUrlWithContext("https://example.com/about", context);
    expect(context.cache.get("https://example.com/about")).toBe("/about");

    context.cache.set("https://example.com/about", "cached-sentinel");
    expect(compressUrlWithContext("https://example.com/about", context)).toBe(
      "cached-sentinel"
    );
  });

  it("caches malformed hrefs as passthrough", () => {
    const context = createUrlCompressionContext();

    expect(compressUrlWithContext("not a url", context)).toBe("not a url");
    expect(context.cache.get("not a url")).toBe("not a url");
  });
});

describe("compressUrl with an unparseable page URL", () => {
  it("returns the absolute form without throwing", () => {
    expect(compressUrl("https://example.com/a", "not a url")).toBe(
      "example.com/a"
    );
  });
});
