import { classify, parseAttributes } from "../../src/parser/element-classifier.js";

describe("parseAttributes", () => {
  it("parses flat attribute array into record", () => {
    const result = parseAttributes(["href", "/home", "class", "nav-link"]);
    expect(result).toEqual({ href: "/home", class: "nav-link" });
  });

  it("returns empty for undefined", () => {
    expect(parseAttributes(undefined)).toEqual({});
  });

  it("returns empty for empty array", () => {
    expect(parseAttributes([])).toEqual({});
  });
});

describe("classify", () => {
  describe("DISCARD", () => {
    it("discards SCRIPT", () => {
      expect(classify("SCRIPT")).toEqual({ action: "DISCARD" });
    });

    it("discards STYLE", () => {
      expect(classify("STYLE")).toEqual({ action: "DISCARD" });
    });

    it("discards LINK", () => {
      expect(classify("LINK")).toEqual({ action: "DISCARD" });
    });

    it("discards META", () => {
      expect(classify("META")).toEqual({ action: "DISCARD" });
    });

    it("discards NOSCRIPT", () => {
      expect(classify("NOSCRIPT")).toEqual({ action: "DISCARD" });
    });

    it("discards TEMPLATE", () => {
      expect(classify("TEMPLATE")).toEqual({ action: "DISCARD" });
    });

    it("discards SVG", () => {
      expect(classify("SVG")).toEqual({ action: "DISCARD" });
    });

    it("discards aria-hidden=true elements", () => {
      expect(classify("DIV", { "aria-hidden": "true" })).toEqual({
        action: "DISCARD",
      });
    });

    it("discards hidden attribute", () => {
      expect(classify("DIV", { hidden: "" })).toEqual({ action: "DISCARD" });
    });

    it("discards display:none", () => {
      expect(classify("DIV", { style: "display:none" })).toEqual({
        action: "DISCARD",
      });
    });

    it("discards visibility:hidden", () => {
      expect(classify("SPAN", { style: "visibility: hidden" })).toEqual({
        action: "DISCARD",
      });
    });
  });

  describe("KEEP", () => {
    it("keeps A as link", () => {
      expect(classify("A")).toEqual({ action: "KEEP", mappedTag: "link" });
    });

    it("keeps BUTTON as button", () => {
      expect(classify("BUTTON")).toEqual({
        action: "KEEP",
        mappedTag: "button",
      });
    });

    it("keeps INPUT as input", () => {
      expect(classify("INPUT")).toEqual({ action: "KEEP", mappedTag: "input" });
    });

    it("keeps SELECT as select", () => {
      expect(classify("SELECT")).toEqual({
        action: "KEEP",
        mappedTag: "select",
      });
    });

    it("keeps TEXTAREA as input", () => {
      expect(classify("TEXTAREA")).toEqual({
        action: "KEEP",
        mappedTag: "input",
      });
    });

    it("keeps FORM as form", () => {
      expect(classify("FORM")).toEqual({ action: "KEEP", mappedTag: "form" });
    });

    it("keeps NAV as nav", () => {
      expect(classify("NAV")).toEqual({ action: "KEEP", mappedTag: "nav" });
    });

    it("keeps TABLE as table", () => {
      expect(classify("TABLE")).toEqual({
        action: "KEEP",
        mappedTag: "table",
      });
    });

    it("keeps H1 as h1", () => {
      expect(classify("H1")).toEqual({
        action: "KEEP",
        mappedTag: "h1",
      });
    });

    it("keeps H6 as h6", () => {
      expect(classify("H6")).toEqual({
        action: "KEEP",
        mappedTag: "h6",
      });
    });

    it("keeps IMG as img", () => {
      expect(classify("IMG")).toEqual({ action: "KEEP", mappedTag: "img" });
    });

    it("keeps UL as list", () => {
      expect(classify("UL")).toEqual({ action: "KEEP", mappedTag: "list" });
    });

    it("keeps LI as item", () => {
      expect(classify("LI")).toEqual({ action: "KEEP", mappedTag: "item" });
    });
  });

  describe("role-based classification", () => {
    it("role=button → button", () => {
      expect(classify("DIV", { role: "button" })).toEqual({
        action: "KEEP",
        mappedTag: "button",
      });
    });

    it("role=navigation → nav", () => {
      expect(classify("DIV", { role: "navigation" })).toEqual({
        action: "KEEP",
        mappedTag: "nav",
      });
    });

    it("role=link → link", () => {
      expect(classify("SPAN", { role: "link" })).toEqual({
        action: "KEEP",
        mappedTag: "link",
      });
    });
  });

  describe("COLLAPSE", () => {
    it("collapses DIV", () => {
      expect(classify("DIV")).toEqual({ action: "COLLAPSE" });
    });

    it("collapses SPAN", () => {
      expect(classify("SPAN")).toEqual({ action: "COLLAPSE" });
    });

    it("collapses P", () => {
      expect(classify("P")).toEqual({ action: "COLLAPSE" });
    });
  });

  describe("semantic landmarks", () => {
    it("collapses SECTION without aria-label", () => {
      expect(classify("SECTION")).toEqual({ action: "COLLAPSE" });
    });

    it("keeps SECTION with aria-label", () => {
      expect(classify("SECTION", { "aria-label": "Features" })).toEqual({
        action: "KEEP",
        mappedTag: "section",
      });
    });

    it("collapses ARTICLE without aria-label or role", () => {
      expect(classify("ARTICLE")).toEqual({ action: "COLLAPSE" });
    });

    it("keeps ARTICLE with role", () => {
      expect(classify("ARTICLE", { role: "article" })).toEqual({
        action: "KEEP",
        mappedTag: "article",
      });
    });

    it("collapses ASIDE without aria-label", () => {
      expect(classify("ASIDE")).toEqual({ action: "COLLAPSE" });
    });

    it("keeps ASIDE with aria-label", () => {
      expect(classify("ASIDE", { "aria-label": "Sidebar" })).toEqual({
        action: "KEEP",
        mappedTag: "aside",
      });
    });

    it("keeps MAIN always", () => {
      expect(classify("MAIN")).toEqual({ action: "KEEP", mappedTag: "main" });
    });

    it("collapses HEADER without interactive children", () => {
      expect(
        classify("HEADER", {}, [
          { nodeName: "DIV" },
          { nodeName: "SPAN" },
        ])
      ).toEqual({ action: "COLLAPSE" });
    });

    it("keeps HEADER with interactive child A", () => {
      expect(
        classify("HEADER", {}, [
          { nodeName: "A", attributes: ["href", "/"] },
        ])
      ).toEqual({ action: "KEEP", mappedTag: "header" });
    });

    it("collapses FOOTER without interactive children", () => {
      expect(classify("FOOTER", {}, [])).toEqual({ action: "COLLAPSE" });
    });

    it("keeps FOOTER with interactive child BUTTON", () => {
      expect(
        classify("FOOTER", {}, [{ nodeName: "BUTTON" }])
      ).toEqual({ action: "KEEP", mappedTag: "footer" });
    });
  });

  // HIGH-010: Proper CSS detection with regex
  describe("CSS style detection", () => {
    it("discards display:none with no spaces", () => {
      expect(classify("DIV", { style: "display:none" })).toEqual({
        action: "DISCARD",
      });
    });

    it("discards display:none with spaces", () => {
      expect(classify("DIV", { style: "display: none" })).toEqual({
        action: "DISCARD",
      });
    });

    it("discards display:none with multiple spaces", () => {
      expect(classify("DIV", { style: "display:  none" })).toEqual({
        action: "DISCARD",
      });
    });

    it("discards display:none with tabs", () => {
      expect(classify("DIV", { style: "display:\tnone" })).toEqual({
        action: "DISCARD",
      });
    });

    it("discards display:none with mixed whitespace", () => {
      expect(classify("DIV", { style: "display \t:  \n none" })).toEqual({
        action: "DISCARD",
      });
    });

    it("does NOT discard display:nonexistent (word boundary check)", () => {
      // "nonexistent" starts with "none" but isn't the same as "none"
      expect(classify("DIV", { style: "display:nonexistent" })).toEqual({
        action: "COLLAPSE",
      });
    });

    it("discards visibility:hidden with no spaces", () => {
      expect(classify("SPAN", { style: "visibility:hidden" })).toEqual({
        action: "DISCARD",
      });
    });

    it("discards visibility:hidden with spaces", () => {
      expect(classify("SPAN", { style: "visibility: hidden" })).toEqual({
        action: "DISCARD",
      });
    });

    it("handles mixed styles with display:none", () => {
      expect(classify("DIV", { style: "color:red;display:none;font-size:12px" })).toEqual({
        action: "DISCARD",
      });
    });

    it("handles case-insensitive style matching", () => {
      expect(classify("DIV", { style: "DISPLAY:NONE" })).toEqual({
        action: "DISCARD",
      });
      expect(classify("DIV", { style: "Display:None" })).toEqual({
        action: "DISCARD",
      });
    });
  });
});
