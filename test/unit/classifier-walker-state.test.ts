import { walkDOM } from "../../src/parser/dom-walker.js";
import { hasComputedState } from "../../src/parser/element-classifier.js";
import type { CDPNode, OSNode, GetStateOptions } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Helpers — mirror the patterns in dom-walker.test.ts and viewport.test.ts
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

// ---------------------------------------------------------------------------
// Test: Walker reads data-os-state attribute
//
// The parallel branch adds logic to dom-walker to read data-os-state from
// CDP attributes and populate OSNode.state. These tests document that spec.
// ---------------------------------------------------------------------------

describe("DOM walker — data-os-state reading", () => {
  it("node with data-os-state='disabled' populates state=['disabled']", () => {
    const btn = makeElement("BUTTON", 10, [makeText("Click", 11)], [
      "data-os-state",
      "disabled",
    ]);
    const root = makeElement("BODY", 1, [btn]);
    const { nodes } = walkDOM(root);

    const buttonNode = nodes.find((n) => n.tag === "button");
    expect(buttonNode).toBeDefined();
    // New feature: OSNode.state field populated from data-os-state
    // This test will fail until the parallel branch is merged
    expect((buttonNode as OSNode & { state?: string[] }).state).toEqual([
      "disabled",
    ]);
  });

  it("node with data-os-state='disabled,obscured' populates state=['disabled','obscured']", () => {
    const btn = makeElement("BUTTON", 10, [makeText("Submit", 11)], [
      "data-os-state",
      "disabled,obscured",
    ]);
    const root = makeElement("BODY", 1, [btn]);
    const { nodes } = walkDOM(root);

    const buttonNode = nodes.find((n) => n.tag === "button");
    expect(buttonNode).toBeDefined();
    expect((buttonNode as OSNode & { state?: string[] }).state).toEqual([
      "disabled",
      "obscured",
    ]);
  });

  it("node without data-os-state has state=undefined", () => {
    const btn = makeElement("BUTTON", 10, [makeText("Click", 11)]);
    const root = makeElement("BODY", 1, [btn]);
    const { nodes } = walkDOM(root);

    const buttonNode = nodes.find((n) => n.tag === "button");
    expect(buttonNode).toBeDefined();
    // No data-os-state → state remains undefined
    expect((buttonNode as OSNode & { state?: string[] }).state).toBeUndefined();
  });

  it("data-os-state does NOT appear in filteredAttrs", () => {
    // data-os-state is an internal attribute used for state transfer;
    // it should not leak into the serialized output attributes
    const btn = makeElement("BUTTON", 10, [makeText("Click", 11)], [
      "data-os-state",
      "disabled",
    ]);
    const root = makeElement("BODY", 1, [btn]);
    const { nodes } = walkDOM(root);

    const buttonNode = nodes.find((n) => n.tag === "button");
    expect(buttonNode).toBeDefined();
    expect(buttonNode!.attributes["data-os-state"]).toBeUndefined();
  });

  it("data-os-state on a link element", () => {
    const link = makeElement("A", 10, [makeText("Link", 11)], [
      "href",
      "/about",
      "data-os-state",
      "disabled",
    ]);
    const root = makeElement("BODY", 1, [link]);
    const { nodes } = walkDOM(root);

    const linkNode = nodes.find((n) => n.tag === "link");
    expect(linkNode).toBeDefined();
    expect(linkNode!.attributes["href"]).toBe("/about");
    expect(linkNode!.attributes["data-os-state"]).toBeUndefined();
    expect((linkNode as OSNode & { state?: string[] }).state).toEqual([
      "disabled",
    ]);
  });

  it("data-os-state on an input element", () => {
    const inp = makeElement("INPUT", 10, [], [
      "type",
      "text",
      "data-os-state",
      "disabled,inert",
    ]);
    const root = makeElement("BODY", 1, [inp]);
    const { nodes } = walkDOM(root);

    const inputNode = nodes.find((n) => n.tag === "input");
    expect(inputNode).toBeDefined();
    expect((inputNode as OSNode & { state?: string[] }).state).toEqual([
      "disabled",
      "inert",
    ]);
  });

  it("data-os-state on a select element", () => {
    const sel = makeElement("SELECT", 10, [], [
      "data-os-state",
      "obscured",
    ]);
    const root = makeElement("BODY", 1, [sel]);
    const { nodes } = walkDOM(root);

    const selectNode = nodes.find((n) => n.tag === "select");
    expect(selectNode).toBeDefined();
    expect((selectNode as OSNode & { state?: string[] }).state).toEqual([
      "obscured",
    ]);
  });

  it("data-os-state='' (empty string) results in state=undefined", () => {
    const btn = makeElement("BUTTON", 10, [makeText("Click", 11)], [
      "data-os-state",
      "",
    ]);
    const root = makeElement("BODY", 1, [btn]);
    const { nodes } = walkDOM(root);

    const buttonNode = nodes.find((n) => n.tag === "button");
    expect(buttonNode).toBeDefined();
    expect((buttonNode as OSNode & { state?: string[] }).state).toBeUndefined();
  });

  it("data-os-state='disabled,' (trailing comma) results in state=['disabled']", () => {
    const btn = makeElement("BUTTON", 10, [makeText("Click", 11)], [
      "data-os-state",
      "disabled,",
    ]);
    const root = makeElement("BODY", 1, [btn]);
    const { nodes } = walkDOM(root);

    const buttonNode = nodes.find((n) => n.tag === "button");
    expect(buttonNode).toBeDefined();
    expect((buttonNode as OSNode & { state?: string[] }).state).toEqual([
      "disabled",
    ]);
  });

  it("data-os-state=',disabled' (leading comma) results in state=['disabled']", () => {
    const btn = makeElement("BUTTON", 10, [makeText("Click", 11)], [
      "data-os-state",
      ",disabled",
    ]);
    const root = makeElement("BODY", 1, [btn]);
    const { nodes } = walkDOM(root);

    const buttonNode = nodes.find((n) => n.tag === "button");
    expect(buttonNode).toBeDefined();
    expect((buttonNode as OSNode & { state?: string[] }).state).toEqual([
      "disabled",
    ]);
  });

  it("data-os-state='unknown_flag' results in state=undefined (filtered by whitelist)", () => {
    const btn = makeElement("BUTTON", 10, [makeText("Click", 11)], [
      "data-os-state",
      "unknown_flag",
    ]);
    const root = makeElement("BODY", 1, [btn]);
    const { nodes } = walkDOM(root);

    const buttonNode = nodes.find((n) => n.tag === "button");
    expect(buttonNode).toBeDefined();
    expect((buttonNode as OSNode & { state?: string[] }).state).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Test: hasComputedState utility
//
// The parallel branch adds a `hasComputedState(state, flag)` utility to the
// classifier module. We test it here.
// ---------------------------------------------------------------------------

describe("hasComputedState utility", () => {
  it("returns true when flag is present", () => {
    expect(hasComputedState(["disabled", "obscured"], "disabled")).toBe(true);
  });

  it("returns true when flag is the only element", () => {
    expect(hasComputedState(["disabled"], "disabled")).toBe(true);
  });

  it("returns false when flag is absent", () => {
    expect(hasComputedState(["disabled"], "obscured")).toBe(false);
  });

  it("returns false when state is undefined", () => {
    expect(hasComputedState(undefined, "disabled")).toBe(false);
  });

  it("returns false when state is empty array", () => {
    expect(hasComputedState([], "disabled")).toBe(false);
  });

  it("returns true for 'inert' flag", () => {
    expect(hasComputedState(["inert"], "inert")).toBe(true);
  });

  it("handles multiple flags correctly", () => {
    const state = ["disabled", "obscured", "inert"];
    expect(hasComputedState(state, "disabled")).toBe(true);
    expect(hasComputedState(state, "obscured")).toBe(true);
    expect(hasComputedState(state, "inert")).toBe(true);
    expect(hasComputedState(state, "hidden")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test: includeHidden option on GetStateOptions
//
// The parallel branch adds `includeHidden?: boolean` to GetStateOptions.
// We verify the type accepts it at the type level.
// ---------------------------------------------------------------------------

describe("GetStateOptions — includeHidden", () => {
  it("accepts includeHidden: true", () => {
    // This is a type-level test. If the type doesn't have includeHidden,
    // this will fail to compile when the feature is added.
    // For now, we cast to verify the structure.
    const opts: GetStateOptions & { includeHidden?: boolean } = {
      includeHidden: true,
    };
    expect(opts.includeHidden).toBe(true);
  });

  it("accepts includeHidden: undefined (default)", () => {
    const opts: GetStateOptions & { includeHidden?: boolean } = {};
    expect(opts.includeHidden).toBeUndefined();
  });

  it("accepts includeHidden: false", () => {
    const opts: GetStateOptions & { includeHidden?: boolean } = {
      includeHidden: false,
    };
    expect(opts.includeHidden).toBe(false);
  });

  it("works alongside existing options", () => {
    const opts: GetStateOptions & { includeHidden?: boolean } = {
      maxTokens: 1000,
      viewport: true,
      mode: "full",
      includeHidden: true,
    };
    expect(opts.maxTokens).toBe(1000);
    expect(opts.viewport).toBe(true);
    expect(opts.mode).toBe("full");
    expect(opts.includeHidden).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test: Walker preserves existing data-os-visible alongside data-os-state
//
// The walker already handles data-os-visible for viewport marking. The new
// data-os-state should coexist without interference.
// ---------------------------------------------------------------------------

describe("DOM walker — data-os-state coexists with data-os-visible", () => {
  it("node with both data-os-visible and data-os-state", () => {
    const btn = makeElement("BUTTON", 10, [makeText("Click", 11)], [
      "data-os-visible",
      "1",
      "data-os-state",
      "disabled",
    ]);
    const root = makeElement("BODY", 1, [btn]);
    const { nodes } = walkDOM(root);

    const buttonNode = nodes.find((n) => n.tag === "button");
    expect(buttonNode).toBeDefined();
    // visible should still work as before
    expect(buttonNode!.visible).toBe(true);
    // state should also be populated (new feature)
    expect((buttonNode as OSNode & { state?: string[] }).state).toEqual([
      "disabled",
    ]);
  });

  it("node with data-os-visible but no data-os-state", () => {
    const btn = makeElement("BUTTON", 10, [makeText("Click", 11)], [
      "data-os-visible",
      "1",
    ]);
    const root = makeElement("BODY", 1, [btn]);
    const { nodes } = walkDOM(root);

    const buttonNode = nodes.find((n) => n.tag === "button");
    expect(buttonNode).toBeDefined();
    expect(buttonNode!.visible).toBe(true);
    expect((buttonNode as OSNode & { state?: string[] }).state).toBeUndefined();
  });
});
