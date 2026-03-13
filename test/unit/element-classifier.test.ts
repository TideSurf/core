import { describe, it, expect } from "vitest";
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

    it("keeps H1 as heading", () => {
      expect(classify("H1")).toEqual({
        action: "KEEP",
        mappedTag: "heading",
      });
    });

    it("keeps H6 as heading", () => {
      expect(classify("H6")).toEqual({
        action: "KEEP",
        mappedTag: "heading",
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

  describe("SECTION promotion", () => {
    it("promotes SECTION with interactive children to section", () => {
      const children = [{ nodeName: "BUTTON", attributes: [] }];
      expect(classify("SECTION", {}, children)).toEqual({
        action: "KEEP",
        mappedTag: "section",
      });
    });

    it("collapses SECTION without interactive children", () => {
      const children = [{ nodeName: "DIV", attributes: [] }];
      expect(classify("SECTION", {}, children)).toEqual({
        action: "COLLAPSE",
      });
    });

    it("promotes ARTICLE with role=button child", () => {
      const children = [{ nodeName: "DIV", attributes: ["role", "button"] }];
      expect(classify("ARTICLE", {}, children)).toEqual({
        action: "KEEP",
        mappedTag: "section",
      });
    });
  });
});
