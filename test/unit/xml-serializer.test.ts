import { describe, it, expect } from "vitest";
import {
  serializeToXml,
  wrapPage,
} from "../../src/parser/xml-serializer.js";
import type { OSNode } from "../../src/types.js";

describe("serializeToXml", () => {
  it("serializes a simple element with text", () => {
    const nodes: OSNode[] = [
      {
        tag: "button",
        id: "B1",
        attributes: { id: "B1" },
        children: [{ tag: "#text", attributes: {}, children: [], text: "Click" }],
      },
    ];
    const xml = serializeToXml(nodes);
    expect(xml).toBe('<button id="B1">Click</button>');
  });

  it("serializes self-closing tags", () => {
    const nodes: OSNode[] = [
      {
        tag: "input",
        id: "I1",
        attributes: { id: "I1", type: "text", placeholder: "Name" },
        children: [],
      },
    ];
    const xml = serializeToXml(nodes);
    expect(xml).toBe('<input id="I1" type="text" placeholder="Name" />');
  });

  it("serializes nested structure with indentation", () => {
    const nodes: OSNode[] = [
      {
        tag: "form",
        id: "F1",
        attributes: { id: "F1" },
        children: [
          {
            tag: "input",
            id: "I1",
            attributes: { id: "I1" },
            children: [],
          },
          {
            tag: "button",
            id: "B1",
            attributes: { id: "B1" },
            children: [
              { tag: "#text", attributes: {}, children: [], text: "Submit" },
            ],
          },
        ],
      },
    ];
    const xml = serializeToXml(nodes);
    expect(xml).toContain('<form id="F1">');
    expect(xml).toContain('  <input id="I1" />');
    expect(xml).toContain('  <button id="B1">Submit</button>');
    expect(xml).toContain("</form>");
  });

  it("escapes XML special characters", () => {
    const nodes: OSNode[] = [
      {
        tag: "heading",
        attributes: {},
        children: [
          { tag: "#text", attributes: {}, children: [], text: 'A & B < C > D "E"' },
        ],
      },
    ];
    const xml = serializeToXml(nodes);
    expect(xml).toContain("A &amp; B &lt; C &gt; D &quot;E&quot;");
  });

  it("handles multiple sibling elements", () => {
    const nodes: OSNode[] = [
      {
        tag: "link",
        id: "L1",
        attributes: { id: "L1", href: "/a" },
        children: [{ tag: "#text", attributes: {}, children: [], text: "A" }],
      },
      {
        tag: "link",
        id: "L2",
        attributes: { id: "L2", href: "/b" },
        children: [{ tag: "#text", attributes: {}, children: [], text: "B" }],
      },
    ];
    const xml = serializeToXml(nodes);
    const lines = xml.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("L1");
    expect(lines[1]).toContain("L2");
  });
});

describe("wrapPage", () => {
  it("wraps XML in page element with url and title", () => {
    const xml = '<button id="B1">Click</button>';
    const result = wrapPage(xml, "https://example.com", "Test");
    expect(result).toBe(
      '<page url="https://example.com" title="Test">\n<button id="B1">Click</button>\n</page>'
    );
  });

  it("escapes special chars in url and title", () => {
    const result = wrapPage("", "https://example.com?a=1&b=2", 'Title "quoted"');
    expect(result).toContain("a=1&amp;b=2");
    expect(result).toContain("&quot;quoted&quot;");
  });

  it("summarizes data URLs to avoid token blowups", () => {
    const dataUrl =
      "data:text/html;charset=utf-8," + encodeURIComponent("<html>" + "x".repeat(2000) + "</html>");
    const result = wrapPage("", dataUrl, "Bench");

    expect(result).toContain('url="data:text/html;charset=utf-8,..."');
    expect(result).not.toContain("x".repeat(100));
  });

  it("truncates very long non-data URLs", () => {
    const longUrl = `https://example.com/${"segment/".repeat(40)}index.html`;
    const result = wrapPage("", longUrl, "Bench");
    const urlAttr = result.match(/url="([^"]+)"/)?.[1] ?? "";

    expect(urlAttr.endsWith("...")).toBe(true);
    expect(urlAttr.length).toBeLessThanOrEqual(160);
  });

  it("adds scroll attributes when scrollPosition is provided", () => {
    const xml = '<button id="B1">Click</button>';
    const result = wrapPage(xml, "https://example.com", "Test", {
      scrollY: 250,
      scrollHeight: 3000,
      viewportHeight: 800,
    });
    expect(result).toContain('scroll-y="250"');
    expect(result).toContain('scroll-height="3000"');
    expect(result).toContain('viewport-height="800"');
    // Should still have url and title
    expect(result).toContain('url="https://example.com"');
    expect(result).toContain('title="Test"');
  });

  it("omits scroll attributes when scrollPosition is undefined", () => {
    const result = wrapPage("", "https://example.com", "Test");
    expect(result).not.toContain("scroll-y");
    expect(result).not.toContain("scroll-height");
    expect(result).not.toContain("viewport-height");
  });
});
