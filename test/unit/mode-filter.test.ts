import { describe, it, expect } from "vitest";
import { filterInteractive, filterMinimal } from "../../src/parser/mode-filter.js";
import type { OSNode } from "../../src/types.js";

// --- Helpers ---

const makeText = (text: string): OSNode => ({
  tag: "#text",
  attributes: {},
  children: [],
  text,
});

const makeNode = (
  tag: string,
  children: OSNode[],
  opts?: { id?: string; text?: string; visible?: boolean }
): OSNode => ({
  tag,
  id: opts?.id,
  attributes: opts?.id ? { id: opts.id } : {},
  children,
  text: opts?.text,
  visible: opts?.visible,
});

// --- filterInteractive ---

describe("filterInteractive", () => {
  it("keeps nodes with IDs and their full subtree", () => {
    const nodes: OSNode[] = [
      makeNode("button", [makeText("Click me")], { id: "B1" }),
    ];
    const result = filterInteractive(nodes);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("B1");
    expect(result[0].children[0].text).toBe("Click me");
  });

  it("removes top-level text nodes without interactive context", () => {
    const nodes: OSNode[] = [
      makeText("orphan text"),
      makeNode("button", [makeText("OK")], { id: "B1" }),
    ];
    const result = filterInteractive(nodes);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("B1");
  });

  it("strips direct text from ancestor-only nodes", () => {
    const nodes: OSNode[] = [
      makeNode("form", [
        makeText("Form label text"),
        makeNode("button", [makeText("Submit")], { id: "B1" }),
      ]),
    ];
    const result = filterInteractive(nodes);
    expect(result).toHaveLength(1);
    expect(result[0].tag).toBe("form");
    // Ancestor node should not have the text child
    const hasTextChild = result[0].children.some((c) => c.tag === "#text");
    expect(hasTextChild).toBe(false);
    // But interactive child should survive
    const button = result[0].children.find((c) => c.id === "B1");
    expect(button).toBeDefined();
  });

  it("removes subtrees with no interactive descendants", () => {
    const nodes: OSNode[] = [
      makeNode("div", [
        makeNode("heading", [makeText("No interactive here")]),
      ]),
      makeNode("div", [
        makeNode("link", [makeText("Click")], { id: "L1" }),
      ]),
    ];
    const result = filterInteractive(nodes);
    expect(result).toHaveLength(1);
    expect(result[0].children[0].id).toBe("L1");
  });

  it("preserves deeply nested interactive elements", () => {
    const nodes: OSNode[] = [
      makeNode("section", [
        makeNode("div", [
          makeNode("nav", [
            makeNode("link", [makeText("Home")], { id: "L1" }),
          ]),
        ]),
      ]),
    ];
    const result = filterInteractive(nodes);
    expect(result).toHaveLength(1);
    // Drill down to find the link
    const json = JSON.stringify(result);
    expect(json).toContain('"id":"L1"');
    expect(json).toContain("Home");
  });

  it("returns empty array when no interactive elements exist", () => {
    const nodes: OSNode[] = [
      makeNode("div", [makeText("just text")]),
      makeText("more text"),
    ];
    const result = filterInteractive(nodes);
    expect(result).toHaveLength(0);
  });

  it("keeps multiple interactive siblings", () => {
    const nodes: OSNode[] = [
      makeNode("nav", [
        makeNode("link", [makeText("A")], { id: "L1" }),
        makeNode("link", [makeText("B")], { id: "L2" }),
        makeNode("link", [makeText("C")], { id: "L3" }),
      ]),
    ];
    const result = filterInteractive(nodes);
    expect(result[0].children).toHaveLength(3);
  });
});

// --- filterMinimal ---

describe("filterMinimal", () => {
  it("keeps landmark tags with text summaries", () => {
    const nodes: OSNode[] = [
      makeNode("heading", [makeText("Welcome to the site")]),
    ];
    const result = filterMinimal(nodes);
    expect(result).toHaveLength(1);
    expect(result[0].tag).toBe("heading");
    expect(result[0].text).toContain("Welcome to the site");
    // Landmark nodes should have no children (flattened to summary)
    expect(result[0].children).toHaveLength(0);
  });

  it("generates interactive counts in summaries", () => {
    const nodes: OSNode[] = [
      makeNode("nav", [
        makeNode("link", [makeText("Home")], { id: "L1" }),
        makeNode("link", [makeText("About")], { id: "L2" }),
        makeNode("button", [makeText("Menu")], { id: "B1" }),
      ]),
    ];
    const result = filterMinimal(nodes);
    expect(result).toHaveLength(1);
    expect(result[0].text).toContain("2 links");
    expect(result[0].text).toContain("1 button");
  });

  it("discards non-landmark, non-text nodes", () => {
    const nodes: OSNode[] = [
      makeNode("div", [makeText("ignored content")]),
    ];
    const result = filterMinimal(nodes);
    expect(result).toHaveLength(0);
  });

  it("discards top-level text nodes", () => {
    const nodes: OSNode[] = [
      makeText("some loose text"),
      makeNode("heading", [makeText("Title")]),
    ];
    const result = filterMinimal(nodes);
    expect(result).toHaveLength(1);
    expect(result[0].tag).toBe("heading");
  });

  it("surfaces nested landmarks from non-landmark parents", () => {
    const nodes: OSNode[] = [
      makeNode("div", [
        makeNode("section", [makeText("Section content")]),
        makeNode("nav", [
          makeNode("link", [makeText("Link")], { id: "L1" }),
        ]),
      ]),
    ];
    const result = filterMinimal(nodes);
    expect(result).toHaveLength(2);
    expect(result[0].tag).toBe("section");
    expect(result[1].tag).toBe("nav");
  });

  it("truncates text to 100 characters", () => {
    const longText = "A".repeat(200);
    const nodes: OSNode[] = [
      makeNode("heading", [makeText(longText)]),
    ];
    const result = filterMinimal(nodes);
    // The text portion (before any interactive summary) should be at most 100 chars
    expect(result[0].text!.length).toBeLessThanOrEqual(100);
  });

  it("handles all landmark tag types", () => {
    const landmarkTags = [
      "h1", "h2", "h3", "h4", "h5", "h6",
      "heading", "nav", "section", "form",
      "main", "header", "footer", "article", "aside",
    ];
    for (const tag of landmarkTags) {
      const nodes: OSNode[] = [makeNode(tag, [makeText("content")])];
      const result = filterMinimal(nodes);
      expect(result).toHaveLength(1);
      expect(result[0].tag).toBe(tag);
    }
  });

  it("returns empty text as undefined", () => {
    const nodes: OSNode[] = [
      makeNode("nav", []),
    ];
    const result = filterMinimal(nodes);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBeUndefined();
  });

  it("uses singular form for count of 1", () => {
    const nodes: OSNode[] = [
      makeNode("nav", [
        makeNode("link", [makeText("Home")], { id: "L1" }),
      ]),
    ];
    const result = filterMinimal(nodes);
    expect(result[0].text).toContain("1 link");
    // Should NOT say "1 links"
    expect(result[0].text).not.toMatch(/1 links/);
  });
});
