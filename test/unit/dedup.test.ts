import { describe, it, expect } from "vitest";
import { deduplicateSiblings } from "../../src/parser/dedup.js";
import type { OSNode } from "../../src/types.js";

const makeText = (text: string): OSNode => ({
  tag: "#text",
  attributes: {},
  children: [],
  text,
});

const makeLink = (id: string, href: string, text: string): OSNode => ({
  tag: "link",
  id,
  attributes: { id, href },
  children: [makeText(text)],
});

const makeItem = (child: OSNode): OSNode => ({
  tag: "item",
  attributes: {},
  children: [child],
});

describe("deduplicateSiblings", () => {
  it("keeps all nodes when run is shorter than minGroupSize", () => {
    const nodes = [
      makeLink("L1", "/a", "A"),
      makeLink("L2", "/b", "B"),
      makeLink("L3", "/c", "C"),
    ];
    const result = deduplicateSiblings(nodes);
    expect(result).toHaveLength(3);
  });

  it("deduplicates runs of 4+ identical-shape siblings", () => {
    const nodes = Array.from({ length: 6 }, (_, i) =>
      makeLink(`L${i + 1}`, `/page${i + 1}`, `Link ${i + 1}`)
    );
    const result = deduplicateSiblings(nodes);
    // 3 kept + 1 summary
    expect(result).toHaveLength(4);
    expect(result[0].id).toBe("L1");
    expect(result[1].id).toBe("L2");
    expect(result[2].id).toBe("L3");
    expect(result[3].tag).toBe("#text");
    expect(result[3].text).toContain("3 more");
    expect(result[3].text).toContain("L4-L6");
  });

  it("respects custom minGroupSize and showCount", () => {
    const nodes = Array.from({ length: 5 }, (_, i) =>
      makeLink(`L${i + 1}`, `/p${i + 1}`, `Link ${i + 1}`)
    );
    const result = deduplicateSiblings(nodes, { minGroupSize: 3, showCount: 2 });
    // 2 kept + 1 summary
    expect(result).toHaveLength(3);
    expect(result[2].text).toContain("3 more");
  });

  it("preserves text nodes between different runs", () => {
    const nodes: OSNode[] = [
      makeLink("L1", "/a", "A"),
      makeLink("L2", "/b", "B"),
      makeText("separator"),
      makeLink("L3", "/c", "C"),
      makeLink("L4", "/d", "D"),
    ];
    const result = deduplicateSiblings(nodes);
    // No dedup — text node breaks the run, and runs are < 4
    expect(result).toHaveLength(5);
  });

  it("recurses into children of kept nodes", () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      makeItem(makeLink(`L${i + 1}`, `/p${i + 1}`, `Link ${i + 1}`))
    );
    // Each item has the same shape (item > link > #text)
    const result = deduplicateSiblings(items);
    // 3 kept + 1 summary
    expect(result).toHaveLength(4);
  });

  it("handles empty arrays", () => {
    expect(deduplicateSiblings([])).toEqual([]);
  });

  it("handles nodes without IDs in summary", () => {
    const nodes = Array.from({ length: 5 }, () => ({
      tag: "heading",
      attributes: {},
      children: [makeText("Title")],
    }));
    const result = deduplicateSiblings(nodes as OSNode[]);
    expect(result).toHaveLength(4);
    expect(result[3].text).toBe("...2 more");
  });
});
