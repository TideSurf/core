import { serialize } from "../../src/parser/serializer.js";
import type { OSNode } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const text = (t: string): OSNode => ({
  tag: "#text",
  attributes: {},
  children: [],
  text: t,
});

const button = (
  id: string,
  label: string,
  extraAttrs: Record<string, string> = {}
): OSNode => ({
  tag: "button",
  id,
  attributes: { id, ...extraAttrs },
  children: [text(label)],
});

const link = (
  id: string,
  href: string,
  label: string,
  extraAttrs: Record<string, string> = {}
): OSNode => ({
  tag: "link",
  id,
  attributes: { id, href, ...extraAttrs },
  children: [text(label)],
});

const select = (
  id: string,
  children: OSNode[] = [],
  extraAttrs: Record<string, string> = {}
): OSNode => ({
  tag: "select",
  id,
  attributes: { id, ...extraAttrs },
  children,
});

const option = (label: string, extraAttrs: Record<string, string> = {}): OSNode => ({
  tag: "option",
  attributes: extraAttrs,
  children: [text(label)],
});

const input = (
  id: string,
  extraAttrs: Record<string, string> = {}
): OSNode => ({
  tag: "input",
  id,
  attributes: { id, ...extraAttrs },
  children: [],
});

// ---------------------------------------------------------------------------
// Tests: Button state flags
// ---------------------------------------------------------------------------

describe("serializer — button state flags", () => {
  it("serializes button with no flags", () => {
    const result = serialize([button("B1", "Submit")]);
    expect(result).toBe("[B1] Submit");
  });

  it("serializes button with disabled attribute", () => {
    const result = serialize([button("B1", "Submit", { disabled: "" })]);
    // New feature: serializer should append "disabled" flag to button output
    // Expected format: "[B1] Submit disabled"
    // Current behavior: buttons don't emit disabled flags; this test documents the new spec
    expect(result).toBe("[B1] Submit disabled");
  });

  it("serializes button with aria-disabled='true'", () => {
    const result = serialize([
      button("B1", "Submit", { "aria-disabled": "true" }),
    ]);
    // New feature: aria-disabled should also result in "disabled" flag on buttons
    expect(result).toBe("[B1] Submit disabled");
  });

  it("serializes button with aria-expanded='true'", () => {
    const result = serialize([
      button("B1", "Menu", { "aria-expanded": "true" }),
    ]);
    // New feature: aria-expanded="true" → "expanded" flag
    expect(result).toBe("[B1] Menu expanded");
  });

  it("serializes button with aria-expanded='false'", () => {
    const result = serialize([
      button("B1", "Menu", { "aria-expanded": "false" }),
    ]);
    // New feature: aria-expanded="false" → "collapsed" flag
    expect(result).toBe("[B1] Menu collapsed");
  });

  it("serializes button with multiple flags", () => {
    const result = serialize([
      button("B1", "Submit", {
        disabled: "",
        "aria-expanded": "true",
      }),
    ]);
    // New feature: multiple flags appended in order
    expect(result).toBe("[B1] Submit disabled expanded");
  });

  it("serializes button with no text but aria-label", () => {
    // Baseline behavior: aria-label fallback already works for buttons
    const btn: OSNode = {
      tag: "button",
      id: "B1",
      attributes: { id: "B1", "aria-label": "Close" },
      children: [],
    };
    const result = serialize([btn]);
    expect(result).toBe("[B1] Close");
  });
});

// ---------------------------------------------------------------------------
// Tests: Link state flags
// ---------------------------------------------------------------------------

describe("serializer — link state flags", () => {
  it("serializes normal link (no state changes)", () => {
    const result = serialize([link("L1", "/about", "About")]);
    expect(result).toBe("[L1](/about) About");
  });

  it("serializes link with target='_blank' using arrow marker", () => {
    const result = serialize([
      link("L1", "/about", "About", { target: "_blank" }),
    ]);
    // New feature: target="_blank" links get → marker in the URL part
    // Expected format: "[L1](/about →) About"
    expect(result).toBe("[L1](/about →) About");
  });

  it("serializes link with aria-disabled", () => {
    const result = serialize([
      link("L1", "/about", "About", { "aria-disabled": "true" }),
    ]);
    // New feature: aria-disabled on links → "disabled" flag appended
    expect(result).toBe("[L1](/about) About disabled");
  });

  it("serializes link with target='_blank' and aria-disabled", () => {
    const result = serialize([
      link("L1", "/about", "About", {
        target: "_blank",
        "aria-disabled": "true",
      }),
    ]);
    // New feature: both flags present
    expect(result).toBe("[L1](/about →) About disabled");
  });

  it("serializes link with target='_self' (no arrow)", () => {
    const result = serialize([
      link("L1", "/about", "About", { target: "_self" }),
    ]);
    // _self is the default, no arrow marker should be added
    expect(result).toBe("[L1](/about) About");
  });

  it("serializes link with URL compression and arrow", () => {
    const result = serialize(
      [link("L1", "https://example.com/page", "Link", { target: "_blank" })],
      0,
      "https://example.com/"
    );
    // URL should be compressed AND arrow should appear
    expect(result).toBe("[L1](/page →) Link");
  });
});

// ---------------------------------------------------------------------------
// Tests: Select state flags
// ---------------------------------------------------------------------------

describe("serializer — select state flags", () => {
  it("serializes select with no flags", () => {
    const result = serialize([select("S1")]);
    expect(result).toBe("S1:select");
  });

  it("serializes select with disabled flag", () => {
    const result = serialize([select("S1", [], { disabled: "" })]);
    // New feature: disabled flag appended to select
    expect(result).toBe("S1:select disabled");
  });

  it("serializes select with required flag", () => {
    const result = serialize([select("S1", [], { required: "" })]);
    // New feature: required flag appended to select
    expect(result).toBe("S1:select required");
  });

  it("serializes select with multiple flag", () => {
    const result = serialize([select("S1", [], { multiple: "" })]);
    // New feature: multiple flag appended to select
    expect(result).toBe("S1:select multiple");
  });

  it("serializes select with combined flags", () => {
    const result = serialize([
      select("S1", [], { disabled: "", required: "", multiple: "" }),
    ]);
    // New feature: all flags in consistent order
    expect(result).toBe("S1:select disabled required multiple");
  });

  it("serializes select with selected option marker", () => {
    // New feature: the selected option gets a ">" prefix marker
    const opts: OSNode[] = [
      option("Apple"),
      option("Banana", { selected: "" }),
      option("Cherry"),
    ];
    const result = serialize([select("S1", opts)]);
    // Selected option should be marked with ">"
    expect(result).toContain("S1:select");
    expect(result).toContain("> Banana");
  });
});

// ---------------------------------------------------------------------------
// Tests: Input enhancements (min/max/step/pattern)
// ---------------------------------------------------------------------------

describe("serializer — input state enhancements", () => {
  it("serializes input with min and max", () => {
    const result = serialize([
      input("I1", { type: "number", min: "0", max: "100" }),
    ]);
    // New feature: min/max attributes serialized for numeric inputs
    expect(result).toBe("I1:number min=0 max=100");
  });

  it("serializes input with step", () => {
    const result = serialize([
      input("I1", { type: "number", step: "0.1" }),
    ]);
    // New feature: step attribute serialized
    expect(result).toBe("I1:number step=0.1");
  });

  it("serializes input with pattern", () => {
    const result = serialize([
      input("I1", { pattern: "[^@]+@[^@]+" }),
    ]);
    // New feature: pattern attribute serialized
    expect(result).toBe("I1 pattern=[^@]+@[^@]+");
  });

  it("serializes input with aria-disabled (treated like disabled)", () => {
    const result = serialize([
      input("I1", { "aria-disabled": "true" }),
    ]);
    // New feature: aria-disabled on input → same as disabled
    expect(result).toBe("I1 disabled");
  });

  it("serializes input with min, max, and step combined", () => {
    const result = serialize([
      input("I1", { type: "range", min: "0", max: "100", step: "5" }),
    ]);
    // All numeric attributes in one line
    expect(result).toBe("I1:range min=0 max=100 step=5");
  });

  it("preserves existing input behavior — disabled attribute", () => {
    // Baseline: disabled already works for inputs in current code
    const result = serialize([input("I1", { disabled: "" })]);
    expect(result).toBe("I1 disabled");
  });

  it("preserves existing input behavior — readonly attribute", () => {
    // Baseline: readonly already works
    const result = serialize([input("I1", { readonly: "" })]);
    expect(result).toBe("I1 readonly");
  });

  it("preserves existing input behavior — required attribute", () => {
    // Baseline: required already works
    const result = serialize([input("I1", { required: "" })]);
    expect(result).toBe("I1 required");
  });

  it("preserves existing input behavior — checked attribute", () => {
    // Baseline: checked already works for checkbox/radio
    const result = serialize([input("I1", { type: "checkbox", checked: "" })]);
    expect(result).toBe("I1:checkbox checked");
  });

  it("preserves existing input behavior — value", () => {
    // Baseline: value rendering unchanged
    const result = serialize([input("I1", { value: "hello" })]);
    expect(result).toBe('I1 ="hello"');
  });

  it("preserves existing input behavior — placeholder", () => {
    // Baseline: placeholder rendering unchanged
    const result = serialize([input("I1", { placeholder: "Search" })]);
    expect(result).toBe("I1 ~Search");
  });

  it("preserves existing input behavior — email type", () => {
    // Baseline: type other than text is shown
    const result = serialize([input("I1", { type: "email", placeholder: "Name" })]);
    expect(result).toBe("I1:email ~Name");
  });
});

// ---------------------------------------------------------------------------
// Tests: Link aria-expanded flags (FIX 5)
// ---------------------------------------------------------------------------

describe("serializer — link aria-expanded flags", () => {
  it("serializes link with aria-expanded='true' as expanded", () => {
    const result = serialize([
      link("L1", "/menu", "Menu", { "aria-expanded": "true" }),
    ]);
    expect(result).toContain("expanded");
  });

  it("serializes link with aria-expanded='false' as collapsed", () => {
    const result = serialize([
      link("L1", "/menu", "Menu", { "aria-expanded": "false" }),
    ]);
    expect(result).toContain("collapsed");
  });
});

// ---------------------------------------------------------------------------
// Tests: Select with optgroup children (FIX 6)
// ---------------------------------------------------------------------------

describe("serializer — select with optgroup", () => {
  const optgroup = (
    label: string,
    children: OSNode[]
  ): OSNode => ({
    tag: "optgroup",
    attributes: { label },
    children,
  });

  it("optgroup label appears with colon suffix", () => {
    const result = serialize([
      select("S1", [
        optgroup("Fruits", [option("Apple"), option("Banana")]),
      ]),
    ]);
    expect(result).toContain("Fruits:");
    expect(result).toContain("Apple");
    expect(result).toContain("Banana");
  });

  it("optgroup uses label attribute as label", () => {
    const result = serialize([
      select("S1", [
        optgroup("Vegetables", [option("Carrot"), option("Pea")]),
      ]),
    ]);
    expect(result).toContain("Vegetables:");
    expect(result).toContain("Carrot");
    expect(result).toContain("Pea");
  });
});

// ---------------------------------------------------------------------------
// Tests: Serializer reads node.state for state flag output (FIX 8)
// ---------------------------------------------------------------------------

describe("serializer — node.state flag output", () => {
  it("button with state: ['disabled'] outputs disabled even without HTML attr", () => {
    const btn: OSNode = {
      tag: "button",
      id: "B1",
      attributes: { id: "B1" },
      children: [text("Submit")],
      state: ["disabled"],
    };
    const result = serialize([btn]);
    expect(result).toContain("disabled");
  });

  it("button with state: ['obscured'] outputs obscured", () => {
    const btn: OSNode = {
      tag: "button",
      id: "B1",
      attributes: { id: "B1" },
      children: [text("Submit")],
      state: ["obscured"],
    };
    const result = serialize([btn]);
    expect(result).toContain("obscured");
  });

  it("button with state: ['inert'] outputs inert", () => {
    const btn: OSNode = {
      tag: "button",
      id: "B1",
      attributes: { id: "B1" },
      children: [text("Submit")],
      state: ["inert"],
    };
    const result = serialize([btn]);
    expect(result).toContain("inert");
  });

  it("link with state: ['disabled', 'obscured'] outputs both flags", () => {
    const lnk: OSNode = {
      tag: "link",
      id: "L1",
      attributes: { id: "L1", href: "/about" },
      children: [text("About")],
      state: ["disabled", "obscured"],
    };
    const result = serialize([lnk]);
    expect(result).toContain("disabled");
    expect(result).toContain("obscured");
  });

  it("input with state: ['disabled'] outputs disabled", () => {
    const inp: OSNode = {
      tag: "input",
      id: "I1",
      attributes: { id: "I1" },
      children: [],
      state: ["disabled"],
    };
    const result = serialize([inp]);
    expect(result).toContain("disabled");
  });
});
