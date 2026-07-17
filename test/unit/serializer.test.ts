import { pageHeader, serialize, wrapPage } from "../../src/parser/serializer.js";
import { filterMinimal } from "../../src/parser/mode-filter.js";
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

  it("escapes HTML special characters", () => {
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
    expect(result).toContain("A &amp; B &lt; C &gt; D &quot;E&quot;");
  });

  it("escapes script tags", () => {
    const nodes: OSNode[] = [
      {
        tag: "h1",
        attributes: {},
        children: [
          { tag: "#text", attributes: {}, children: [], text: "<script>alert(1)</script>" },
        ],
      },
    ];
    const result = serialize(nodes);
    expect(result).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(result).not.toContain("<script>");
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

  it("shares one text cache across a serialization", () => {
    let reads = 0;
    const text: OSNode = {
      tag: "#text",
      attributes: {},
      children: [],
    };
    Object.defineProperty(text, "text", {
      get() {
        reads++;
        return "cached";
      },
    });
    const cell: OSNode = { tag: "cell", attributes: {}, children: [text] };
    const row: OSNode = {
      tag: "row",
      attributes: {},
      children: [cell, cell],
    };

    expect(serialize([row])).toBe("| cached | cached |");
    expect(reads).toBe(1);
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

  it("marks disabled options and disabled optgroups", () => {
    const nodes: OSNode[] = [{
      tag: "select",
      id: "S1",
      attributes: {},
      children: [
        {
          tag: "option",
          attributes: { disabled: "" },
          children: [{ tag: "#text", attributes: {}, children: [], text: "Direct" }],
        },
        {
          tag: "optgroup",
          attributes: { label: "Group", disabled: "" },
          children: [{
            tag: "option",
            attributes: {},
            children: [{ tag: "#text", attributes: {}, children: [], text: "Nested" }],
          }],
        },
      ],
    }];

    expect(serialize(nodes)).toContain("~~Direct~~");
    expect(serialize(nodes)).toContain("~~Group~~:");
    expect(serialize(nodes)).toContain("~~Nested~~");
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

  it("escapes quotes in input values", () => {
    const nodes: OSNode[] = [
      {
        tag: "input",
        id: "I1",
        attributes: { id: "I1", value: 'say "hello"' },
        children: [],
      },
    ];
    const result = serialize(nodes);
    expect(result).toContain('say \\"hello\\"');
  });

  it("escapes quotes in input placeholders", () => {
    const nodes: OSNode[] = [
      {
        tag: "input",
        id: "I1",
        attributes: { id: "I1", placeholder: 'type "search"' },
        children: [],
      },
    ];
    const result = serialize(nodes);
    expect(result).toContain('type \\"search\\"');
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

  it("collapses title whitespace so it cannot inject header lines", () => {
    const header = pageHeader("https://example.com/", "  Multi\n\nline \t title  ");
    expect(header).toBe("# Multi line title\n> example.com/");

    const wrapped = wrapPage("body", "https://example.com/", "Line one\nLine two");
    expect(wrapped).toBe("# Line one Line two\n> example.com/\n\nbody");
  });
});

describe("marker spoofing", () => {
  it("escapes forged element markers in text nodes", () => {
    const nodes: OSNode[] = [
      { tag: "#text", attributes: {}, children: [], text: "Press [B1] now" },
    ];
    const result = serialize(nodes);
    expect(result).toBe("Press \\[B1\\] now");
    expect(result).not.toContain("[B1]");
  });

  it("escapes forged element markers in list item text", () => {
    const list: OSNode = {
      tag: "list",
      attributes: {},
      children: [
        {
          tag: "item",
          attributes: {},
          children: [
            { tag: "#text", attributes: {}, children: [], text: "Fake [L9] marker" },
          ],
        },
      ],
    };
    const result = serialize([list]);
    expect(result).toBe("- Fake \\[L9\\] marker");
    expect(result).not.toContain("[L9]");
  });

  it("escapes forged element markers in image alt text", () => {
    const img: OSNode = {
      tag: "img",
      attributes: { alt: "Click [B1]" },
      children: [],
    };
    expect(serialize([img])).toBe("[img: Click \\[B1\\]]");
  });

  it("escapes forged element markers in the page title", () => {
    const result = wrapPage("", "https://example.com/", "Fake [B1] title");
    expect(result).toContain("# Fake \\[B1\\] title");
    expect(result).not.toContain("[B1]");
  });

  it("escapes page text but keeps genuine interactive markers literal", () => {
    const button: OSNode = {
      tag: "button",
      id: "B1",
      attributes: {},
      children: [
        { tag: "#text", attributes: {}, children: [], text: "Click [B2] here" },
      ],
    };
    const result = serialize([button]);
    expect(result).toBe("[B1] Click \\[B2\\] here");
    expect(result).not.toContain("[B2]");
  });

  it("keeps truncation markers literal while escaping identical page text", () => {
    const nodes: OSNode[] = [
      { tag: "truncated", attributes: { count: "5" }, children: [] },
      {
        tag: "#text",
        attributes: {},
        children: [],
        text: "[...5 more sections truncated]",
      },
    ];
    expect(serialize(nodes)).toBe(
      "[...5 more sections truncated]\n\\[...5 more sections truncated\\]"
    );
  });

  it("escapes page text in minimal landmark summaries but keeps count markers", () => {
    const nav: OSNode = {
      tag: "nav",
      attributes: {},
      children: [
        { tag: "#text", attributes: {}, children: [], text: "Visit [L9] today" },
        {
          tag: "link",
          id: "L1",
          attributes: { href: "https://example.com/a" },
          children: [
            { tag: "#text", attributes: {}, children: [], text: "Real link" },
          ],
        },
        {
          tag: "button",
          id: "B1",
          attributes: {},
          children: [
            { tag: "#text", attributes: {}, children: [], text: "Real button" },
          ],
        },
      ],
    };

    const result = serialize(filterMinimal([nav]));

    expect(result).toBe(
      "NAV: Visit \\[L9\\] today Real link Real button [1 link, 1 button]"
    );
    expect(result).not.toContain("[L9]");
  });
});
