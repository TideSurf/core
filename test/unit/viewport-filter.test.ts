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
    const { nodes: result } = filterViewportOnly(nodes);
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
    const { nodes: result } = filterViewportOnly(nodes);
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
    const { nodes: result } = filterViewportOnly(nodes);
    expect(result).toHaveLength(1);
    expect(result[0].tag).toBe("section");
    const json = JSON.stringify(result);
    expect(json).toContain('"id":"B1"');
  });

  it("removes text nodes without visibility", () => {
    const nodes: OSNode[] = [
      makeText("invisible text"),
      makeNode("heading", [makeText("visible heading")], { visible: true }),
    ];
    const { nodes: result } = filterViewportOnly(nodes);
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
    const { nodes: result } = filterViewportOnly(nodes);
    expect(result).toHaveLength(1);
    expect(result[0].children).toHaveLength(1);
    expect(result[0].children[0].children[0].text).toBe("Above fold");
  });

  it("preserves node properties on ancestor pass-through", () => {
    const nodes: OSNode[] = [
      makeNode("nav", [
        makeNode("link", [makeText("Home")], { id: "L1", visible: true }),
      ]),
    ];
    const { nodes: result } = filterViewportOnly(nodes);
    expect(result[0].tag).toBe("nav");
    expect(result[0].text).toBeUndefined();
    expect(result[0].attributes).toEqual({});
  });

  it("returns empty nodes when nothing is visible", () => {
    const nodes: OSNode[] = [
      makeNode("div", [makeText("hidden")]),
      makeNode("section", [makeNode("heading", [makeText("also hidden")])]),
    ];
    const { nodes: result } = filterViewportOnly(nodes);
    expect(result).toHaveLength(0);
  });

  it("keeps entire subtree when parent is visible", () => {
    const nodes: OSNode[] = [
      makeNode("nav", [
        makeNode("link", [makeText("A")], { id: "L1" }),
        makeNode("link", [makeText("B")], { id: "L2" }),
      ], { visible: true }),
    ];
    const { nodes: result } = filterViewportOnly(nodes);
    expect(result).toHaveLength(1);
    expect(result[0].children).toHaveLength(2);
  });

  it("generates above summary for off-screen nodes before visible", () => {
    const nodes: OSNode[] = [
      makeNode("nav", [
        makeNode("link", [makeText("Home")], { id: "L1" }),
        makeNode("link", [makeText("About")], { id: "L2" }),
      ]),
      makeNode("button", [makeText("Visible")], { id: "B1", visible: true }),
    ];
    const { nodes: result, aboveSummary } = filterViewportOnly(nodes);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("B1");
    expect(aboveSummary).toBeDefined();
    expect(aboveSummary!.tag).toBe("above");
    expect(aboveSummary!.text).toContain("nav");
  });

  it("generates below summary for off-screen nodes after visible", () => {
    const nodes: OSNode[] = [
      makeNode("button", [makeText("Visible")], { id: "B1", visible: true }),
      makeNode("nav", [
        makeNode("link", [makeText("Footer Link")], { id: "L1" }),
      ]),
    ];
    const { nodes: result, belowSummary } = filterViewportOnly(nodes);
    expect(result).toHaveLength(1);
    expect(belowSummary).toBeDefined();
    expect(belowSummary!.tag).toBe("below");
  });

  it("returns no summaries when all nodes are visible", () => {
    const nodes: OSNode[] = [
      makeNode("button", [makeText("A")], { id: "B1", visible: true }),
      makeNode("button", [makeText("B")], { id: "B2", visible: true }),
    ];
    const { aboveSummary, belowSummary } = filterViewportOnly(nodes);
    expect(aboveSummary).toBeUndefined();
    expect(belowSummary).toBeUndefined();
  });

  // HIGH-004: Stack overflow protection with depth limit
  it("handles deeply nested trees without stack overflow", () => {
    // Create a deeply nested structure with a visible node at the bottom (within MAX_FILTER_DEPTH = 500)
    let deepNode = makeNode("button", [makeText("Deep")], { id: "B1", visible: true });
    for (let i = 0; i < 400; i++) {
      deepNode = makeNode("div", [deepNode]);
    }
    const nodes: OSNode[] = [deepNode];
    
    // Should not throw
    const { nodes: result } = filterViewportOnly(nodes);
    expect(result.length).toBeGreaterThan(0);
  });
});
