import { describe, it, expect } from "vitest";
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
    expect(nodes[0].tag).toBe("heading");
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
});
