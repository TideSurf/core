import { walkDOM } from "../../src/parser/dom-walker.js";
import type { CDPNode, OSNode } from "../../src/types.js";

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

function makeText(text: string, id: number = 0): CDPNode {
  return {
    nodeId: id,
    backendNodeId: id,
    nodeType: 3,
    nodeName: "#text",
    localName: "",
    nodeValue: text,
  };
}

function walkMappedNode(
  nodeName: string,
  mappedTag: string,
  attributes: string[] = []
): OSNode {
  const element = makeElement(nodeName, 10, [makeText("Content", 11)], attributes);
  const node = walkDOM(makeElement("BODY", 1, [element])).nodes.find(
    (candidate) => candidate.tag === mappedTag
  );
  expect(node).toBeDefined();
  return node!;
}

describe("DOM walker marker state", () => {
  it("keeps supported flags and removes parser markers", () => {
    const node = walkMappedNode("BUTTON", "button", [
      "title",
      "Action",
      "data-os-state",
      ",disabled,obscured,",
    ]);

    expect(node.state).toEqual(["disabled", "obscured"]);
    expect(node.attributes).toEqual({ id: "B1", title: "Action" });
  });

  it("ignores absent, empty, and unsupported state values", () => {
    for (const value of [undefined, "", "unknown_flag"]) {
      const attributes = value === undefined ? [] : ["data-os-state", value];
      expect(walkMappedNode("BUTTON", "button", attributes).state).toBeUndefined();
    }
  });

  it("applies state to mapped interactive elements", () => {
    const cases = [
      ["A", "link", "disabled"],
      ["INPUT", "input", "disabled,inert"],
      ["SELECT", "select", "obscured"],
    ] as const;

    for (const [nodeName, mappedTag, value] of cases) {
      expect(
        walkMappedNode(nodeName, mappedTag, ["data-os-state", value]).state
      ).toEqual(value.split(","));
    }
  });

  it("combines visibility and state markers", () => {
    const node = walkMappedNode("BUTTON", "button", [
      "data-os-visible",
      "1",
      "data-os-state",
      "disabled",
    ]);

    expect(node.visible).toBe(true);
    expect(node.state).toEqual(["disabled"]);
  });
});
