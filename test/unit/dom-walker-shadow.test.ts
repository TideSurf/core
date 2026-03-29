import { walkDOM } from "../../src/parser/dom-walker.js";
import type { CDPNode } from "../../src/types.js";

function makeElement(
  nodeName: string,
  backendNodeId: number,
  children: CDPNode[] = [],
  attrs?: string[],
  shadowRoots?: CDPNode[]
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
    shadowRoots,
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

describe("DOM Walker - Shadow DOM", () => {
  it("walks shadow root children and merges them into host", () => {
    const shadowButton = makeElement("BUTTON", 10, [makeText("Shadow Btn", 11)]);
    const shadowRoot: CDPNode = {
      nodeId: 9,
      backendNodeId: 9,
      nodeType: 11, // DocumentFragment
      nodeName: "#document-fragment",
      localName: "",
      nodeValue: "",
      children: [shadowButton],
    };

    // Custom element with shadow root — it will COLLAPSE (not in KEEP_TAG_MAP)
    // so shadow children get promoted
    const host = makeElement("MY-COMPONENT", 8, [], [], [shadowRoot]);

    const root = makeElement("BODY", 1, [
      makeElement("H1", 2, [makeText("Title", 3)]),
      host,
    ]);

    const { nodes } = walkDOM(root);

    // The heading should be there
    const heading = nodes.find((n) => n.tag === "h1");
    expect(heading).toBeDefined();

    // The shadow button should be promoted (host COLLAPSEs)
    const button = nodes.find((n) => n.tag === "button");
    expect(button).toBeDefined();
    expect(button!.id).toBe("B1");
  });

  it("walks shadow root children into a KEEP host element", () => {
    const shadowLink = makeElement("A", 20, [makeText("Shadow Link", 21)], [
      "href",
      "/shadow-link",
    ]);
    const shadowRoot: CDPNode = {
      nodeId: 19,
      backendNodeId: 19,
      nodeType: 11,
      nodeName: "#document-fragment",
      localName: "",
      nodeValue: "",
      children: [shadowLink],
    };

    // NAV is KEEP — shadow children should become its children
    const nav = makeElement("NAV", 18, [], [], [shadowRoot]);

    const root = makeElement("BODY", 1, [nav]);
    const { nodes } = walkDOM(root);

    const navNode = nodes.find((n) => n.tag === "nav");
    expect(navNode).toBeDefined();

    const link = navNode!.children.find((n) => n.tag === "link");
    expect(link).toBeDefined();
    expect(link!.attributes["href"]).toBe("/shadow-link");
  });
});
