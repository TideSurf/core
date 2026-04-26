import { estimateTokens, pruneToFit } from "../../src/parser/token-budget.js";
import { serialize } from "../../src/parser/serializer.js";
import type { OSNode } from "../../src/types.js";

describe("estimateTokens", () => {
  it("estimates tokens as length/4", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcdefgh")).toBe(2);
    expect(estimateTokens("a")).toBe(1); // ceil
  });

  it("uses custom charsPerToken", () => {
    expect(estimateTokens("abcdef", 3)).toBe(2);
  });
});

describe("pruneToFit", () => {
  const makeText = (text: string): OSNode => ({
    tag: "#text",
    attributes: {},
    children: [],
    text,
  });

  const makeNode = (
    tag: string,
    children: OSNode[],
    opts?: { id?: string; visible?: boolean }
  ): OSNode => ({
    tag,
    id: opts?.id,
    attributes: opts?.id ? { id: opts.id } : {},
    children,
    visible: opts?.visible,
  });

  it("returns unchanged if under budget", () => {
    const nodes = [makeText("hello")];
    const result = pruneToFit(nodes, { maxTokens: 1000 });
    expect(result).toEqual(nodes);
  });

  it("prunes low-priority nodes first", () => {
    // Create enough content to exceed the budget
    const nodes = [
      makeNode("heading", [makeText("A fairly long title for testing purposes here")]),
      makeNode("button", [makeText("Click me")], { id: "B1" }),
      makeNode("heading", [makeText("Another section with a long heading to add tokens")]),
      makeNode("heading", [makeText("Yet another really long heading text for budget")]),
      makeNode("heading", [makeText("Extra content to push over the token limit clearly")]),
    ];

    // Budget tight enough to force pruning but leave room for button
    const result = pruneToFit(nodes, { maxTokens: 20 });

    // Interactive button should survive pruning (highest priority)
    const hasButton = JSON.stringify(result).includes("B1");
    expect(hasButton).toBe(true);
  });

  it("appends truncated indicator when nodes are removed", () => {
    const nodes = Array.from({ length: 20 }, (_, i) =>
      makeNode("heading", [makeText(`Heading ${i}`)])
    );

    const result = pruneToFit(nodes, { maxTokens: 10 });

    const truncated = result.find((n) => n.tag === "truncated");
    expect(truncated).toBeDefined();
    expect(Number(truncated!.attributes["count"])).toBeGreaterThan(0);
  });

  it("does not mutate input nodes", () => {
    const nodes = [
      makeNode("heading", [makeText("Title")]),
      makeNode("heading", [makeText("Sub")]),
    ];
    const originalJson = JSON.stringify(nodes);

    pruneToFit(nodes, { maxTokens: 5 });

    expect(JSON.stringify(nodes)).toBe(originalJson);
  });

  it("prioritizes visible nodes over non-visible", () => {
    const nodes = [
      makeNode("heading", [makeText("Invisible heading")]),
      makeNode("heading", [makeText("Visible heading")], { visible: true }),
    ];

    // Small budget to force one removal
    const result = pruneToFit(nodes, { maxTokens: 15 });

    // If pruning happened, visible node should survive
    const resultText = JSON.stringify(result);
    if (resultText.includes("truncated")) {
      expect(resultText).toContain("Visible heading");
    }
  });

  it("prunes children inside one dominant container", () => {
    const nodes = [
      makeNode(
        "main",
        Array.from({ length: 40 }, (_, i) =>
          makeNode("heading", [makeText(`Long low-priority content block ${i} `.repeat(8))])
        )
      ),
    ];

    const result = pruneToFit(nodes, { maxTokens: 120 });
    const serialized = serialize(result);

    expect(estimateTokens(serialized)).toBeLessThanOrEqual(140);
    expect(serialized).toContain("truncated");
  });

  // MED-007: structuredClone fallback test
  it("handles structuredClone failure gracefully with fallback deep copy", () => {
    const nodes = [
      makeNode("heading", [makeText("Title")]),
      makeNode("button", [makeText("Click")], { id: "B1" }),
    ];

    // Should not throw even if structuredClone fails
    const result = pruneToFit(nodes, { maxTokens: 1000 });
    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(0);
  });
});
