import { describe, it, expect } from "vitest";
import { filterViewportOnly } from "../../src/parser/viewport-filter.js";
import type { OSNode } from "../../src/types.js";

// --- Helpers ---

const makeText = (text: string, visible?: boolean): OSNode => ({
  tag: "#text",
  attributes: {},
  children: [],
  text,
  visible,
});

const makeNode = (
  tag: string,
  children: OSNode[],
  opts?: { id?: string; visible?: boolean; text?: string }
): OSNode => ({
  tag,
  id: opts?.id,
  attributes: opts?.id ? { id: opts.id } : {},
  children,
  text: opts?.text,
  visible: opts?.visible,
});

describe("filterViewportOnly", () => {
  it("keeps nodes marked as visible", () => {
    const nodes: OSNode[] = [
      makeNode("button", [makeText("Click")], { id: "B1", visible: true }),
    ];
    const result = filterViewportOnly(nodes);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("B1");
  });

  it("removes entirely invisible subtrees", () => {
    const nodes: OSNode[] = [
      makeNode("div", [
        makeNode("heading", [makeText("Hidden")]),
        makeNode("button", [makeText("Also hidden")], { id: "B1" }),
      ]),
    ];
    const result = filterViewportOnly(nodes);
    expect(result).toHaveLength(0);
  });

  it("keeps ancestors of visible nodes", () => {
    const nodes: OSNode[] = [
      makeNode("section", [
        makeNode("div", [
          makeNode("button", [makeText("Visible btn")], {
            id: "B1",
            visible: true,
          }),
        ]),
      ]),
    ];
    const result = filterViewportOnly(nodes);
    expect(result).toHaveLength(1);
    expect(result[0].tag).toBe("section");
    // Drill down to button
    const json = JSON.stringify(result);
    expect(json).toContain('"id":"B1"');
  });

  it("removes text nodes without visibility", () => {
    const nodes: OSNode[] = [
      makeText("invisible text"),
      makeNode("heading", [makeText("visible heading")], { visible: true }),
    ];
    const result = filterViewportOnly(nodes);
    expect(result).toHaveLength(1);
    expect(result[0].tag).toBe("heading");
  });

  it("filters siblings — keeps visible, removes invisible", () => {
    const nodes: OSNode[] = [
      makeNode("div", [
        makeNode("heading", [makeText("Above fold")], { visible: true }),
        makeNode("heading", [makeText("Below fold")]),
      ]),
    ];
    const result = filterViewportOnly(nodes);
    expect(result).toHaveLength(1);
    // The div ancestor is kept with only the visible child
    expect(result[0].children).toHaveLength(1);
    expect(result[0].children[0].children[0].text).toBe("Above fold");
  });

  it("preserves node properties on ancestor pass-through", () => {
    const nodes: OSNode[] = [
      makeNode("nav", [
        makeNode("link", [makeText("Home")], { id: "L1", visible: true }),
      ]),
    ];
    const result = filterViewportOnly(nodes);
    expect(result[0].tag).toBe("nav");
    expect(result[0].text).toBeUndefined();
    // Original node attributes should be preserved
    expect(result[0].attributes).toEqual({});
  });

  it("returns empty array when nothing is visible", () => {
    const nodes: OSNode[] = [
      makeNode("div", [makeText("hidden")]),
      makeNode("section", [makeNode("heading", [makeText("also hidden")])]),
    ];
    const result = filterViewportOnly(nodes);
    expect(result).toHaveLength(0);
  });

  it("keeps entire subtree when parent is visible", () => {
    const nodes: OSNode[] = [
      makeNode("nav", [
        makeNode("link", [makeText("A")], { id: "L1" }),
        makeNode("link", [makeText("B")], { id: "L2" }),
      ], { visible: true }),
    ];
    const result = filterViewportOnly(nodes);
    expect(result).toHaveLength(1);
    // Both children should be kept since parent is visible
    expect(result[0].children).toHaveLength(2);
  });
});
