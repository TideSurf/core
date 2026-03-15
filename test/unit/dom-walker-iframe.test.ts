import { describe, it, expect } from "vitest";
import { walkDOM } from "../../src/parser/dom-walker.js";
import type { CDPNode } from "../../src/types.js";

function makeElement(
  nodeName: string,
  backendNodeId: number,
  children: CDPNode[] = [],
  attrs?: string[],
  contentDocument?: CDPNode
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
    contentDocument,
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

describe("DOM Walker - iframe", () => {
  it("walks same-origin iframe content", () => {
    const iframeBody = makeElement("BODY", 30, [
      makeElement("H2", 31, [makeText("Child Heading", 32)]),
      makeElement("A", 33, [makeText("Child Link", 34)], ["href", "/child"]),
    ]);
    const iframeDoc: CDPNode = {
      nodeId: 29,
      backendNodeId: 29,
      nodeType: 9, // Document
      nodeName: "#document",
      localName: "",
      nodeValue: "",
      children: [iframeBody],
    };

    const iframe = makeElement(
      "IFRAME",
      20,
      [],
      ["src", "child.html"],
      iframeDoc
    );

    const root = makeElement("BODY", 1, [
      makeElement("H1", 2, [makeText("Parent", 3)]),
      iframe,
    ]);

    const { nodes } = walkDOM(root);

    // Parent heading
    const heading = nodes.find((n) => n.tag === "h1");
    expect(heading).toBeDefined();

    // iframe node should exist with children from the content document
    const iframeNode = nodes.find((n) => n.tag === "iframe");
    expect(iframeNode).toBeDefined();
    expect(iframeNode!.attributes["src"]).toBe("child.html");

    // Should have child content
    const childHeading = iframeNode!.children.find((n) => n.tag === "h2");
    expect(childHeading).toBeDefined();

    const childLink = iframeNode!.children.find((n) => n.tag === "link");
    expect(childLink).toBeDefined();
  });

  it("emits inaccessible marker for cross-origin iframes", () => {
    // IFRAME without contentDocument = cross-origin
    const iframe = makeElement("IFRAME", 20, [], ["src", "https://other.com"]);

    const root = makeElement("BODY", 1, [iframe]);
    const { nodes } = walkDOM(root);

    const iframeNode = nodes.find((n) => n.tag === "iframe");
    expect(iframeNode).toBeDefined();
    expect(iframeNode!.attributes["status"]).toBe("inaccessible");
    expect(iframeNode!.children).toHaveLength(0);
  });
});
