import { describe, it, expect } from "vitest";
import { walkDOM } from "../../src/parser/dom-walker.js";
import type { CDPNode } from "../../src/types.js";

function makeElement(
  nodeName: string,
  backendNodeId: number,
  children: CDPNode[] = [],
  attrs?: string[]
): CDPNode {
  return {
    nodeId: backendNodeId,
    backendNodeId,
    nodeType: 1,
    nodeName,
    localName: nodeName.toLowerCase(),
    nodeValue: "",
    children,
    attributes: attrs ?? [],
  };
}

function makeText(text: string, id: number): CDPNode {
  return {
    nodeId: id,
    backendNodeId: id,
    nodeType: 3,
    nodeName: "#text",
    localName: "",
    nodeValue: text,
  };
}

describe("Viewport-aware visible marking", () => {
  it("marks nodes with data-os-visible as visible=true", () => {
    const button = makeElement("BUTTON", 10, [makeText("Click", 11)], [
      "data-os-visible",
      "1",
    ]);

    const heading = makeElement("H1", 12, [makeText("Title", 13)]);

    const root = makeElement("BODY", 1, [button, heading]);
    const { nodes } = walkDOM(root);

    const btn = nodes.find((n) => n.tag === "button");
    expect(btn).toBeDefined();
    expect(btn!.visible).toBe(true);

    const h = nodes.find((n) => n.tag === "heading");
    expect(h).toBeDefined();
    expect(h!.visible).toBeUndefined();
  });

  it("does not mark nodes without data-os-visible", () => {
    const link = makeElement("A", 10, [makeText("Link", 11)], [
      "href",
      "/page",
    ]);

    const root = makeElement("BODY", 1, [link]);
    const { nodes } = walkDOM(root);

    const linkNode = nodes.find((n) => n.tag === "link");
    expect(linkNode).toBeDefined();
    expect(linkNode!.visible).toBeUndefined();
  });
});
