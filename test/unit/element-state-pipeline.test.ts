import { walkDOM } from "../../src/parser/dom-walker.js";
import { serialize } from "../../src/parser/serializer.js";
import { filterViewportOnly } from "../../src/parser/viewport-filter.js";
import { filterInteractive } from "../../src/parser/mode-filter.js";
import type { CDPNode, OSNode } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Helpers — Build CDPNode trees that simulate real DOM structures
// ---------------------------------------------------------------------------

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

/**
 * Run the full pipeline: CDPNode tree → walkDOM → serialize
 */
function pipeline(body: CDPNode[], pageUrl?: string): string {
  const root = makeElement("BODY", 1, body);
  const { nodes } = walkDOM(root);
  return serialize(nodes, 0, pageUrl);
}

/**
 * Run walkDOM and return the OSNodes for inspection
 */
function walk(body: CDPNode[]): OSNode[] {
  const root = makeElement("BODY", 1, body);
  return walkDOM(root).nodes;
}

// ---------------------------------------------------------------------------
// Integration: CDPNode → walkDOM → serialize for disabled buttons
// ---------------------------------------------------------------------------

describe("pipeline — disabled button", () => {
  it("button with disabled attribute serializes with ~~strikethrough~~", () => {
    const result = pipeline([
      makeElement("BUTTON", 10, [makeText("Submit", 11)], [
        "disabled",
        "",
      ]),
    ]);
    // Disabled elements are wrapped in ~~strikethrough~~
    // This tests the full CDPNode → OSNode → text pipeline
    expect(result).toContain("Submit");
    expect(result).toContain("~~");
  });

  it("button without disabled produces clean output", () => {
    const result = pipeline([
      makeElement("BUTTON", 10, [makeText("Submit", 11)]),
    ]);
    expect(result).toBe("[B1] Submit");
    expect(result).not.toContain("disabled");
  });
});

// ---------------------------------------------------------------------------
// Integration: CDPNode → walkDOM → serialize for aria-expanded
// ---------------------------------------------------------------------------

describe("pipeline — aria-expanded button", () => {
  it("button with aria-expanded='true' serializes with open flag", () => {
    const result = pipeline([
      makeElement("BUTTON", 10, [makeText("Menu", 11)], [
        "aria-expanded",
        "true",
      ]),
    ]);
    expect(result).toContain("Menu");
    // aria-expanded="true" → "open" flag
    expect(result).toContain("open");
  });

  it("button with aria-expanded='false' serializes with closed flag", () => {
    const result = pipeline([
      makeElement("BUTTON", 10, [makeText("Menu", 11)], [
        "aria-expanded",
        "false",
      ]),
    ]);
    expect(result).toContain("Menu");
    // aria-expanded="false" → "closed" flag
    expect(result).toContain("closed");
  });
});

// ---------------------------------------------------------------------------
// Integration: CDPNode → walkDOM → serialize for select with selected option
// ---------------------------------------------------------------------------

describe("pipeline — select with selected option", () => {
  it("select with selected option child gets marker in output", () => {
    const result = pipeline([
      makeElement("SELECT", 10, [
        makeElement("OPTION", 11, [makeText("Apple", 12)]),
        makeElement("OPTION", 13, [makeText("Banana", 14)], ["selected", ""]),
        makeElement("OPTION", 15, [makeText("Cherry", 16)]),
      ]),
    ]);
    expect(result).toContain("S1:select");
    // New feature: selected option marked with ">"
    expect(result).toContain("> Banana");
  });
});

// ---------------------------------------------------------------------------
// Integration: CDPNode → walkDOM for display:none elements
// ---------------------------------------------------------------------------

describe("pipeline — inline style display:none", () => {
  it("element with inline style display:none is discarded", () => {
    const result = pipeline([
      makeElement("DIV", 10, [makeText("Hidden content", 11)], [
        "style",
        "display:none",
      ]),
      makeElement("BUTTON", 12, [makeText("Visible", 13)]),
    ]);
    // The classifier already discards display:none elements
    expect(result).not.toContain("Hidden content");
    expect(result).toContain("Visible");
  });

  it("element with inline style display: none (with space) is discarded", () => {
    const result = pipeline([
      makeElement("DIV", 10, [makeText("Hidden content", 11)], [
        "style",
        "display: none",
      ]),
      makeElement("BUTTON", 12, [makeText("Visible", 13)]),
    ]);
    expect(result).not.toContain("Hidden content");
    expect(result).toContain("Visible");
  });
});

// ---------------------------------------------------------------------------
// Integration: CDPNode → walkDOM for visibility:hidden elements
// ---------------------------------------------------------------------------

describe("pipeline — inline style visibility:hidden", () => {
  it("element with visibility:hidden is discarded", () => {
    const result = pipeline([
      makeElement("SPAN", 10, [makeText("Invisible", 11)], [
        "style",
        "visibility: hidden",
      ]),
      makeElement("BUTTON", 12, [makeText("Visible", 13)]),
    ]);
    expect(result).not.toContain("Invisible");
    expect(result).toContain("Visible");
  });
});

// ---------------------------------------------------------------------------
// Integration: CDPNode → walkDOM for aria-hidden subtrees
// ---------------------------------------------------------------------------

describe("pipeline — aria-hidden subtrees", () => {
  it("aria-hidden='true' subtree is discarded entirely", () => {
    const result = pipeline([
      makeElement(
        "DIV",
        10,
        [
          makeElement("BUTTON", 11, [makeText("Hidden Btn", 12)]),
          makeElement("A", 13, [makeText("Hidden Link", 14)], ["href", "/x"]),
        ],
        ["aria-hidden", "true"]
      ),
      makeElement("BUTTON", 15, [makeText("Visible", 16)]),
    ]);
    expect(result).not.toContain("Hidden Btn");
    expect(result).not.toContain("Hidden Link");
    expect(result).toContain("Visible");
  });

  it("aria-hidden='false' does not discard subtree", () => {
    const result = pipeline([
      makeElement("DIV", 10, [makeElement("BUTTON", 11, [makeText("Keep Me", 12)])], [
        "aria-hidden",
        "false",
      ]),
    ]);
    expect(result).toContain("Keep Me");
  });
});

// ---------------------------------------------------------------------------
// Integration: CDPNode → walkDOM → serialize for data-os-state
// ---------------------------------------------------------------------------

describe("pipeline — data-os-state propagation", () => {
  it("button with data-os-state='disabled' has state field populated", () => {
    const nodes = walk([
      makeElement("BUTTON", 10, [makeText("Click", 11)], [
        "data-os-state",
        "disabled",
      ]),
    ]);

    const btn = nodes.find((n) => n.tag === "button");
    expect(btn).toBeDefined();
    // New feature: state field on OSNode
    expect((btn as OSNode & { state?: string[] }).state).toEqual(["disabled"]);
    // data-os-state should not be in serialized attributes
    expect(btn!.attributes["data-os-state"]).toBeUndefined();
  });

  it("link with data-os-state='disabled,obscured' has both state flags", () => {
    const nodes = walk([
      makeElement("A", 10, [makeText("Link", 11)], [
        "href",
        "/about",
        "data-os-state",
        "disabled,obscured",
      ]),
    ]);

    const linkNode = nodes.find((n) => n.tag === "link");
    expect(linkNode).toBeDefined();
    expect((linkNode as OSNode & { state?: string[] }).state).toEqual([
      "disabled",
      "obscured",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Integration: Combined features — disabled button + data-os-visible
// ---------------------------------------------------------------------------

describe("pipeline — combined viewport visibility and state", () => {
  it("button marked visible with disabled attribute", () => {
    const btn = makeElement("BUTTON", 10, [makeText("Submit", 11)], [
      "data-os-visible",
      "1",
      "disabled",
      "",
    ]);
    const root = makeElement("BODY", 1, [btn]);
    const { nodes } = walkDOM(root);

    const buttonNode = nodes.find((n) => n.tag === "button");
    expect(buttonNode).toBeDefined();
    expect(buttonNode!.visible).toBe(true);
    expect(buttonNode!.attributes["disabled"]).toBe("");
  });

  it("disabled button that is also data-os-visible serializes with ~~strikethrough~~", () => {
    const btn = makeElement("BUTTON", 10, [makeText("Submit", 11)], [
      "data-os-visible",
      "1",
      "disabled",
      "",
    ]);
    const root = makeElement("BODY", 1, [btn]);
    const { nodes } = walkDOM(root);
    const result = serialize(nodes);
    expect(result).toContain("Submit");
    expect(result).toContain("~~");
  });
});

// ---------------------------------------------------------------------------
// Integration: Input attributes pass through pipeline
// ---------------------------------------------------------------------------

describe("pipeline — input attributes", () => {
  it("input with min/max passes through walker and serializer", () => {
    const result = pipeline([
      makeElement("INPUT", 10, [], [
        "type",
        "number",
        "min",
        "0",
        "max",
        "100",
      ]),
    ]);
    // New feature: min/max serialized in output
    expect(result).toContain("I1");
    expect(result).toContain("number");
    expect(result).toContain("min=0");
    expect(result).toContain("max=100");
  });

  it("input disabled attribute passes through the pipeline", () => {
    const result = pipeline([
      makeElement("INPUT", 10, [], ["disabled", ""]),
    ]);
    expect(result).toContain("I1");
    expect(result).toContain("~~");
  });

  it("input readonly attribute passes through the pipeline", () => {
    const result = pipeline([
      makeElement("INPUT", 10, [], ["readonly", ""]),
    ]);
    expect(result).toContain("I1");
    expect(result).toContain("readonly");
  });

  it("input required attribute passes through the pipeline", () => {
    const result = pipeline([
      makeElement("INPUT", 10, [], ["required", ""]),
    ]);
    expect(result).toContain("I1");
    expect(result).toContain("required");
  });

  it("input with placeholder and value passes through the pipeline", () => {
    const result = pipeline([
      makeElement("INPUT", 10, [], [
        "placeholder",
        "Search",
        "value",
        "test",
      ]),
    ]);
    expect(result).toContain("~Search");
    expect(result).toContain('="test"');
  });
});

// ---------------------------------------------------------------------------
// Integration: Link with target="_blank" passes through pipeline
// ---------------------------------------------------------------------------

describe("pipeline — link target=_blank", () => {
  it("link with target=_blank gets arrow in serialized output", () => {
    const result = pipeline([
      makeElement("A", 10, [makeText("External", 11)], [
        "href",
        "https://other.com",
        "target",
        "_blank",
      ]),
    ]);
    // New feature: target="_blank" → arrow marker in output
    expect(result).toContain("External");
    expect(result).toContain("other.com");
    expect(result).toContain("→");
  });

  it("link without target does not get arrow", () => {
    const result = pipeline([
      makeElement("A", 10, [makeText("Internal", 11)], [
        "href",
        "/about",
      ]),
    ]);
    expect(result).toContain("[L1](/about) Internal");
    expect(result).not.toContain("→");
  });
});

// ---------------------------------------------------------------------------
// Integration: Form with multiple interactive elements
// ---------------------------------------------------------------------------

describe("pipeline — complex form", () => {
  it("form with disabled input, required select, and submit button", () => {
    const form = makeElement(
      "FORM",
      10,
      [
        makeElement("INPUT", 11, [], [
          "type",
          "email",
          "placeholder",
          "Email",
          "required",
          "",
        ]),
        makeElement("SELECT", 12, [
          makeElement("OPTION", 13, [makeText("Choose...", 14)]),
          makeElement("OPTION", 15, [makeText("Option A", 16)]),
        ]),
        makeElement("BUTTON", 17, [makeText("Submit", 18)]),
      ],
      ["action", "/submit"]
    );

    const result = pipeline([form]);
    expect(result).toContain("FORM F1");
    expect(result).toContain("I1:email ~Email");
    expect(result).toContain("required");
    expect(result).toContain("S1:select");
    expect(result).toContain("[B1] Submit");
  });
});

// ---------------------------------------------------------------------------
// Verify nodeMap integrity through the pipeline
// ---------------------------------------------------------------------------

describe("pipeline — nodeMap integrity with state attributes", () => {
  it("nodeMap maps IDs to correct backendNodeIds with state attrs present", () => {
    const root = makeElement("BODY", 1, [
      makeElement("BUTTON", 100, [makeText("Btn", 101)], [
        "disabled",
        "",
        "data-os-visible",
        "1",
      ]),
      makeElement("A", 200, [makeText("Link", 201)], [
        "href",
        "/page",
        "target",
        "_blank",
      ]),
      makeElement("INPUT", 300, [], [
        "type",
        "email",
        "required",
        "",
      ]),
      makeElement("SELECT", 400, [], [
        "multiple",
        "",
      ]),
    ]);

    const { nodes, nodeMap } = walkDOM(root);

    // All interactive elements should have IDs mapped
    expect(nodeMap.get("B1")).toBe(100);
    expect(nodeMap.get("L1")).toBe(200);
    expect(nodeMap.get("I1")).toBe(300);
    expect(nodeMap.get("S1")).toBe(400);

    // Verify nodes were actually created
    expect(nodes.some((n) => n.tag === "button")).toBe(true);
    expect(nodes.some((n) => n.tag === "link")).toBe(true);
    expect(nodes.some((n) => n.tag === "input")).toBe(true);
    expect(nodes.some((n) => n.tag === "select")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// State survives through filters (FIX 7)
// ---------------------------------------------------------------------------

describe("pipeline — state survives filterViewportOnly", () => {
  it("node with state and visible: true keeps its state", () => {
    const btn: OSNode = {
      tag: "button",
      id: "B1",
      attributes: { id: "B1" },
      children: [{ tag: "#text", attributes: {}, children: [], text: "Click" }],
      visible: true,
      state: ["disabled"],
    };
    const result = filterViewportOnly([btn]);
    const found = result.nodes.find((n) => n.tag === "button");
    expect(found).toBeDefined();
    expect(found!.state).toEqual(["disabled"]);
  });

  it("ancestor node preserves state through viewport filter", () => {
    const child: OSNode = {
      tag: "button",
      id: "B1",
      attributes: { id: "B1" },
      children: [{ tag: "#text", attributes: {}, children: [], text: "Click" }],
      visible: true,
    };
    const parent: OSNode = {
      tag: "nav",
      attributes: {},
      children: [child],
      state: ["inert"],
    };
    const result = filterViewportOnly([parent]);
    const nav = result.nodes.find((n) => n.tag === "nav");
    expect(nav).toBeDefined();
    expect(nav!.state).toEqual(["inert"]);
  });
});

describe("pipeline — state survives filterInteractive", () => {
  it("node with state and id keeps its state", () => {
    const btn: OSNode = {
      tag: "button",
      id: "B1",
      attributes: { id: "B1" },
      children: [{ tag: "#text", attributes: {}, children: [], text: "Click" }],
      state: ["obscured"],
    };
    const result = filterInteractive([btn]);
    const found = result.find((n) => n.tag === "button");
    expect(found).toBeDefined();
    expect(found!.state).toEqual(["obscured"]);
  });

  it("ancestor node preserves state through interactive filter", () => {
    const child: OSNode = {
      tag: "button",
      id: "B1",
      attributes: { id: "B1" },
      children: [{ tag: "#text", attributes: {}, children: [], text: "Click" }],
    };
    const parent: OSNode = {
      tag: "form",
      attributes: {},
      children: [child],
      state: ["disabled"],
    };
    const result = filterInteractive([parent]);
    const form = result.find((n) => n.tag === "form");
    expect(form).toBeDefined();
    expect(form!.state).toEqual(["disabled"]);
  });
});
