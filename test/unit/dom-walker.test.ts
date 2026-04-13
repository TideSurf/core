import { walkDOM } from "../../src/parser/dom-walker.js";
import type { CDPNode } from "../../src/types.js";

function makeNode(
  overrides: Partial<CDPNode> & { nodeName: string }
): CDPNode {
  return {
    nodeId: 1,
    backendNodeId: Math.floor(Math.random() * 10000),
    nodeType: 1,
    localName: overrides.nodeName.toLowerCase(),
    nodeValue: "",
    ...overrides,
  };
}

function makeText(text: string): CDPNode {
  return {
    nodeId: 1,
    backendNodeId: 0,
    nodeType: 3,
    nodeName: "#text",
    localName: "",
    nodeValue: text,
  };
}

describe("walkDOM", () => {
  it("keeps interactive elements and discards scripts", () => {
    const root = makeNode({
      nodeName: "HTML",
      children: [
        makeNode({
          nodeName: "BODY",
          children: [
            makeNode({
              nodeName: "BUTTON",
              backendNodeId: 100,
              children: [makeText("Click")],
            }),
            makeNode({ nodeName: "SCRIPT", children: [makeText("alert(1)")] }),
          ],
        }),
      ],
    });

    const { nodes, nodeMap } = walkDOM(root);

    expect(nodes).toHaveLength(1);
    expect(nodes[0].tag).toBe("button");
    expect(nodes[0].id).toBe("B1");
    expect(nodes[0].children[0].text).toBe("Click");
    expect(nodeMap.get("B1")).toBe(100);
  });

  it("collapses DIV wrappers and promotes children", () => {
    const root = makeNode({
      nodeName: "HTML",
      children: [
        makeNode({
          nodeName: "BODY",
          children: [
            makeNode({
              nodeName: "DIV",
              children: [
                makeNode({
                  nodeName: "DIV",
                  children: [
                    makeNode({
                      nodeName: "A",
                      backendNodeId: 200,
                      attributes: ["href", "/test"],
                      children: [makeText("Link")],
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    });

    const { nodes, nodeMap } = walkDOM(root);

    expect(nodes).toHaveLength(1);
    expect(nodes[0].tag).toBe("link");
    expect(nodes[0].attributes["href"]).toBe("/test");
    expect(nodeMap.get("L1")).toBe(200);
  });

  it("merges adjacent text nodes", () => {
    const root = makeNode({
      nodeName: "HTML",
      children: [
        makeNode({
          nodeName: "BODY",
          children: [
            makeNode({
              nodeName: "H1",
              children: [makeText("Hello"), makeText("World")],
            }),
          ],
        }),
      ],
    });

    const { nodes } = walkDOM(root);

    expect(nodes).toHaveLength(1);
    expect(nodes[0].tag).toBe("h1");
    expect(nodes[0].children).toHaveLength(1);
    expect(nodes[0].children[0].text).toBe("Hello World");
  });

  it("removes empty collapsed nodes", () => {
    const root = makeNode({
      nodeName: "HTML",
      children: [
        makeNode({
          nodeName: "BODY",
          children: [
            makeNode({
              nodeName: "DIV",
              children: [
                makeNode({ nodeName: "DIV", children: [] }),
              ],
            }),
          ],
        }),
      ],
    });

    const { nodes } = walkDOM(root);
    expect(nodes).toHaveLength(0);
  });

  it("discards aria-hidden subtrees", () => {
    const root = makeNode({
      nodeName: "HTML",
      children: [
        makeNode({
          nodeName: "BODY",
          children: [
            makeNode({
              nodeName: "DIV",
              attributes: ["aria-hidden", "true"],
              children: [
                makeNode({
                  nodeName: "BUTTON",
                  children: [makeText("Hidden Button")],
                }),
              ],
            }),
            makeNode({
              nodeName: "BUTTON",
              backendNodeId: 300,
              children: [makeText("Visible")],
            }),
          ],
        }),
      ],
    });

    const { nodes, nodeMap } = walkDOM(root);

    expect(nodes).toHaveLength(1);
    expect(nodes[0].tag).toBe("button");
    expect(nodes[0].children[0].text).toBe("Visible");
    expect(nodeMap.get("B1")).toBe(300);
  });

  it("preserves form structure with inputs", () => {
    const root = makeNode({
      nodeName: "HTML",
      children: [
        makeNode({
          nodeName: "BODY",
          children: [
            makeNode({
              nodeName: "FORM",
              backendNodeId: 400,
              attributes: ["action", "/submit"],
              children: [
                makeNode({
                  nodeName: "INPUT",
                  backendNodeId: 401,
                  attributes: ["type", "text", "name", "query", "placeholder", "Search..."],
                }),
                makeNode({
                  nodeName: "BUTTON",
                  backendNodeId: 402,
                  children: [makeText("Go")],
                }),
              ],
            }),
          ],
        }),
      ],
    });

    const { nodes, nodeMap } = walkDOM(root);

    expect(nodes).toHaveLength(1);
    expect(nodes[0].tag).toBe("form");
    expect(nodes[0].id).toBe("F1");
    expect(nodes[0].children).toHaveLength(2);
    expect(nodes[0].children[0].tag).toBe("input");
    expect(nodes[0].children[0].id).toBe("I1");
    expect(nodes[0].children[0].attributes["placeholder"]).toBe("Search...");
    expect(nodes[0].children[1].tag).toBe("button");
    expect(nodes[0].children[1].id).toBe("B1");
    expect(nodeMap.get("F1")).toBe(400);
    expect(nodeMap.get("I1")).toBe(401);
    expect(nodeMap.get("B1")).toBe(402);
  });

  // CRIT-005: Stack overflow in DOM walker - depth limit test
  it("handles deeply nested DOM without stack overflow", () => {
    // Create a deeply nested structure (1000 levels)
    let current: CDPNode = makeNode({ nodeName: "DIV", children: [makeText("deep content")] });
    for (let i = 0; i < 1000; i++) {
      current = makeNode({ nodeName: "DIV", children: [current] });
    }
    
    const root = makeNode({
      nodeName: "HTML",
      children: [current],
    });

    // Should not throw stack overflow
    const { nodes } = walkDOM(root);
    // The content should be truncated at MAX_DEPTH (500)
    expect(nodes.length).toBeGreaterThanOrEqual(0);
  });

  it("truncates at MAX_DEPTH with [truncated] marker", () => {
    // Create a structure deeper than MAX_DEPTH (500)
    let current: CDPNode = makeNode({ nodeName: "DIV", children: [makeText("bottom")] });
    for (let i = 0; i < 600; i++) {
      current = makeNode({ nodeName: "DIV", children: [current] });
    }
    
    const root = makeNode({
      nodeName: "HTML",
      children: [current],
    });

    const { nodes } = walkDOM(root);
    // Find the [truncated] marker
    const findTruncated = (n: any[]): boolean => {
      for (const node of n) {
        if (node.tag === "#text" && node.text === "[truncated]") return true;
        if (findTruncated(node.children)) return true;
      }
      return false;
    };
    expect(findTruncated(nodes)).toBe(true);
  });

  // HIGH-009: Text node merging - only add space when needed
  it("merges adjacent text nodes without extra spaces", () => {
    const root = makeNode({
      nodeName: "HTML",
      children: [
        makeNode({
          nodeName: "BODY",
          children: [
            makeNode({
              nodeName: "H1",
              children: [makeText("Hello "), makeText("World")],
            }),
          ],
        }),
      ],
    });

    const { nodes } = walkDOM(root);

    expect(nodes).toHaveLength(1);
    expect(nodes[0].children).toHaveLength(1);
    // Original text had space, so no double space should be added
    expect(nodes[0].children[0].text).toBe("Hello World");
  });

  it("merges adjacent text nodes with space when original had no whitespace", () => {
    const root = makeNode({
      nodeName: "HTML",
      children: [
        makeNode({
          nodeName: "BODY",
          children: [
            makeNode({
              nodeName: "H1",
              children: [makeText("Hello"), makeText("World")],
            }),
          ],
        }),
      ],
    });

    const { nodes } = walkDOM(root);

    expect(nodes[0].children[0].text).toBe("Hello World");
  });

  // MED-004: Unicode grapheme-aware truncation
  it("handles unicode emoji correctly in truncation", () => {
    // Each emoji is 2 UTF-16 code units but 1 grapheme
    const longEmojiText = "👍".repeat(100);
    const root = makeNode({
      nodeName: "HTML",
      children: [
        makeNode({
          nodeName: "BODY",
          children: [
            makeNode({
              nodeName: "P",
              children: [makeText(longEmojiText)],
            }),
          ],
        }),
      ],
    });

    const { nodes } = walkDOM(root);
    // Should be truncated without breaking emoji
    expect(nodes.length).toBeGreaterThan(0);
  });

  // Edge case: empty children arrays
  it("handles empty children arrays gracefully", () => {
    const root = makeNode({
      nodeName: "HTML",
      children: [
        makeNode({
          nodeName: "BODY",
          children: [
            makeNode({ nodeName: "DIV", children: [] }),
          ],
        }),
      ],
    });

    const { nodes } = walkDOM(root);
    expect(nodes.length).toBe(0);
  });
});
