import { serialize, wrapPage } from "../../src/parser/serializer.js";
import type { OSNode } from "../../src/types.js";

describe("serialize", () => {
  it("serializes a button with text", () => {
    const nodes: OSNode[] = [
      {
        tag: "button",
        id: "B1",
        attributes: { id: "B1" },
        children: [{ tag: "#text", attributes: {}, children: [], text: "Click" }],
      },
    ];
    const result = serialize(nodes);
    expect(result).toBe("[B1] Click");
  });

  it("serializes an input with type and placeholder", () => {
    const nodes: OSNode[] = [
      {
        tag: "input",
        id: "I1",
        attributes: { id: "I1", type: "email", placeholder: "Name" },
        children: [],
      },
    ];
    const result = serialize(nodes);
    expect(result).toBe("I1:email ~Name");
  });

  it("omits :text for default type inputs", () => {
    const nodes: OSNode[] = [
      {
        tag: "input",
        id: "I1",
        attributes: { id: "I1", placeholder: "Search" },
        children: [],
      },
    ];
    const result = serialize(nodes);
    expect(result).toBe("I1 ~Search");
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
    const result = serialize(nodes);
    expect(result).toContain("FORM F1");
    expect(result).toContain("  I1");
    expect(result).toContain("  [B1] Submit");
  });

  it("does not escape XML special characters (plain text)", () => {
    const nodes: OSNode[] = [
      {
        tag: "h1",
        attributes: {},
        children: [
          { tag: "#text", attributes: {}, children: [], text: 'A & B < C > D "E"' },
        ],
      },
    ];
    const result = serialize(nodes);
    expect(result).toContain('A & B < C > D "E"');
  });

  it("handles multiple sibling links", () => {
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
    const result = serialize(nodes);
    const lines = result.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("L1");
    expect(lines[1]).toContain("L2");
  });

  it("serializes headings with markdown prefixes", () => {
    const h1: OSNode = {
      tag: "h1",
      attributes: {},
      children: [{ tag: "#text", attributes: {}, children: [], text: "Title" }],
    };
    const h2: OSNode = {
      tag: "h2",
      attributes: {},
      children: [{ tag: "#text", attributes: {}, children: [], text: "Subtitle" }],
    };
    const h3: OSNode = {
      tag: "h3",
      attributes: {},
      children: [{ tag: "#text", attributes: {}, children: [], text: "Section" }],
    };
    const result = serialize([h1, h2, h3]);
    expect(result).toContain("# Title");
    expect(result).toContain("## Subtitle");
    expect(result).toContain("### Section");
  });

  it("compresses URLs in links", () => {
    const nodes: OSNode[] = [
      {
        tag: "link",
        id: "L1",
        attributes: { id: "L1", href: "https://example.com/page" },
        children: [{ tag: "#text", attributes: {}, children: [], text: "Link" }],
      },
    ];
    const result = serialize(nodes, 0, "https://example.com/");
    expect(result).toBe("[L1](/page) Link");
  });

  it("serializes images", () => {
    const withAlt: OSNode = {
      tag: "img",
      attributes: { alt: "Logo" },
      children: [],
    };
    const withoutAlt: OSNode = {
      tag: "img",
      attributes: {},
      children: [],
    };
    expect(serialize([withAlt])).toBe("[img: Logo]");
    expect(serialize([withoutAlt])).toBe("[img]");
  });

  it("serializes iframes", () => {
    const inaccessible: OSNode = {
      tag: "iframe",
      attributes: { status: "inaccessible" },
      children: [],
    };
    expect(serialize([inaccessible])).toBe("[iframe: inaccessible]");
  });

  it("serializes truncated nodes", () => {
    const node: OSNode = {
      tag: "truncated",
      attributes: { count: "5" },
      children: [],
    };
    expect(serialize([node])).toBe("[...5 more sections truncated]");
  });

  it("serializes list items", () => {
    const list: OSNode = {
      tag: "list",
      attributes: {},
      children: [
        {
          tag: "item",
          attributes: {},
          children: [{ tag: "#text", attributes: {}, children: [], text: "First" }],
        },
        {
          tag: "item",
          attributes: {},
          children: [{ tag: "#text", attributes: {}, children: [], text: "Second" }],
        },
      ],
    };
    const result = serialize([list]);
    expect(result).toContain("- First");
    expect(result).toContain("- Second");
  });

  it("serializes table rows", () => {
    const row: OSNode = {
      tag: "row",
      attributes: {},
      children: [
        { tag: "cell", attributes: {}, children: [{ tag: "#text", attributes: {}, children: [], text: "A" }] },
        { tag: "cell", attributes: {}, children: [{ tag: "#text", attributes: {}, children: [], text: "B" }] },
      ],
    };
    expect(serialize([row])).toBe("| A | B |");
  });

  it("serializes data URLs in wrapPage safely", () => {
    const dataUrl =
      "data:text/html;charset=utf-8," + encodeURIComponent("<html>" + "x".repeat(2000) + "</html>");
    const result = wrapPage("", dataUrl, "Bench");
    expect(result).toContain("data:text/html;charset=utf-8,...");
    expect(result).not.toContain("x".repeat(100));
  });

  it("serializes input with value", () => {
    const nodes: OSNode[] = [
      {
        tag: "input",
        id: "I1",
        attributes: { id: "I1", value: "hello" },
        children: [],
      },
    ];
    const result = serialize(nodes);
    expect(result).toBe('I1 ="hello"');
  });

  it("serializes select", () => {
    const nodes: OSNode[] = [
      {
        tag: "select",
        id: "S1",
        attributes: { id: "S1" },
        children: [],
      },
    ];
    const result = serialize(nodes);
    expect(result).toBe("S1:select");
  });

  it("serializes labels", () => {
    const nodes: OSNode[] = [
      {
        tag: "label",
        attributes: {},
        children: [{ tag: "#text", attributes: {}, children: [], text: "Email" }],
      },
    ];
    const result = serialize(nodes);
    expect(result).toBe("Email:");
  });
});

describe("wrapPage", () => {
  it("wraps body with title and URL header", () => {
    const body = "[B1] Click";
    const result = wrapPage(body, "https://example.com", "Test");
    expect(result).toContain("# Test");
    expect(result).toContain("> example.com");
    expect(result).toContain("[B1] Click");
  });

  it("adds scroll metadata when scrollPosition is provided", () => {
    const result = wrapPage("[B1] Click", "https://example.com", "Test", {
      scrollY: 250,
      scrollHeight: 3000,
      viewportHeight: 800,
    });
    expect(result).toContain("250/3000 800vh");
    expect(result).toContain("# Test");
    expect(result).toContain("> example.com");
  });

  it("omits scroll metadata when scrollPosition is undefined", () => {
    const result = wrapPage("", "https://example.com", "Test");
    expect(result).not.toContain("vh");
  });

  it("compresses long URLs", () => {
    const longUrl = `https://example.com/${"segment/".repeat(40)}index.html`;
    const result = wrapPage("", longUrl, "Test");
    expect(result).toContain("...");
  });
});
