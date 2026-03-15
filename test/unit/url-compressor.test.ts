import { describe, it, expect } from "vitest";
import { compressUrl } from "../../src/parser/url-compressor.js";

describe("compressUrl", () => {
  it("strips tracking params", () => {
    const result = compressUrl(
      "https://example.com/page?utm_source=google&utm_medium=cpc&id=123"
    );
    expect(result).toBe("example.com/page?id=123");
  });

  it("strips all utm_ variants", () => {
    const result = compressUrl(
      "https://example.com/?utm_campaign=test&utm_content=ad1&utm_term=kw"
    );
    expect(result).toBe("example.com/");
  });

  it("strips fbclid, gclid, _ga, _gl", () => {
    const result = compressUrl(
      "https://example.com/page?fbclid=abc&gclid=def&_ga=123&_gl=456"
    );
    expect(result).toBe("example.com/page");
  });

  it("relativizes same-origin URLs", () => {
    const result = compressUrl(
      "https://example.com/about/team",
      "https://example.com/home"
    );
    expect(result).toBe("/about/team");
  });

  it("does not relativize cross-origin URLs", () => {
    const result = compressUrl(
      "https://other.com/page",
      "https://example.com/home"
    );
    expect(result).toBe("other.com/page");
  });

  it("drops protocol", () => {
    const result = compressUrl("https://example.com/path");
    expect(result).toBe("example.com/path");
    expect(result).not.toContain("https://");
  });

  it("truncates long paths (>4 segments)", () => {
    const result = compressUrl(
      "https://example.com/a/b/c/d/e/f/index.html"
    );
    expect(result).toBe("example.com/a/b/.../index.html");
  });

  it("does not truncate short paths", () => {
    const result = compressUrl("https://example.com/a/b/c");
    expect(result).toBe("example.com/a/b/c");
  });

  it("passes through javascript: URLs", () => {
    expect(compressUrl("javascript:void(0)")).toBe("javascript:void(0)");
  });

  it("passes through hash-only URLs", () => {
    expect(compressUrl("#section")).toBe("#section");
  });

  it("passes through blob: URLs", () => {
    expect(compressUrl("blob:https://example.com/abc")).toBe(
      "blob:https://example.com/abc"
    );
  });

  it("passes through data: URLs", () => {
    expect(compressUrl("data:text/html,<h1>Hi</h1>")).toBe(
      "data:text/html,<h1>Hi</h1>"
    );
  });

  it("passes through malformed URLs", () => {
    expect(compressUrl("not a url")).toBe("not a url");
  });

  it("preserves query params that are not tracking", () => {
    const result = compressUrl("https://example.com/search?q=test&page=2");
    expect(result).toBe("example.com/search?q=test&page=2");
  });

  it("preserves hash fragments", () => {
    const result = compressUrl("https://example.com/page#section");
    expect(result).toBe("example.com/page#section");
  });

  it("handles same-origin with query and hash", () => {
    const result = compressUrl(
      "https://example.com/page?q=1#top",
      "https://example.com/"
    );
    expect(result).toBe("/page?q=1#top");
  });
});
