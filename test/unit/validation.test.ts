import { describe, it, expect } from "vitest";
import {
  validateUrl,
  validateSelector,
  validateExpression,
  validateElementId,
} from "../../src/validation.js";
import { ValidationError } from "../../src/errors.js";

describe("validateUrl", () => {
  it("accepts valid http URLs", () => {
    expect(() => validateUrl("http://example.com")).not.toThrow();
    expect(() => validateUrl("https://example.com/path?q=1")).not.toThrow();
  });

  it("rejects empty string", () => {
    expect(() => validateUrl("")).toThrow(ValidationError);
  });

  it("rejects non-http URLs", () => {
    expect(() => validateUrl("ftp://example.com")).toThrow(ValidationError);
    expect(() => validateUrl("javascript:alert(1)")).toThrow(ValidationError);
  });
});

describe("validateSelector", () => {
  it("accepts valid selectors", () => {
    expect(() => validateSelector("#id")).not.toThrow();
    expect(() => validateSelector(".class > div")).not.toThrow();
  });

  it("rejects empty string", () => {
    expect(() => validateSelector("")).toThrow(ValidationError);
  });

  it("rejects overly long selectors", () => {
    expect(() => validateSelector("a".repeat(1001))).toThrow(ValidationError);
  });
});

describe("validateExpression", () => {
  it("accepts valid expressions", () => {
    expect(() => validateExpression("document.title")).not.toThrow();
  });

  it("rejects empty string", () => {
    expect(() => validateExpression("")).toThrow(ValidationError);
  });

  it("rejects overly long expressions", () => {
    expect(() => validateExpression("x".repeat(10001))).toThrow(ValidationError);
  });
});

describe("validateElementId", () => {
  it("accepts valid element IDs", () => {
    expect(() => validateElementId("B1")).not.toThrow();
    expect(() => validateElementId("L23")).not.toThrow();
    expect(() => validateElementId("I5")).not.toThrow();
    expect(() => validateElementId("S100")).not.toThrow();
  });

  it("rejects empty string", () => {
    expect(() => validateElementId("")).toThrow(ValidationError);
  });

  it("rejects invalid formats", () => {
    expect(() => validateElementId("b1")).toThrow(ValidationError);
    expect(() => validateElementId("button")).toThrow(ValidationError);
    expect(() => validateElementId("1B")).toThrow(ValidationError);
    expect(() => validateElementId("B")).toThrow(ValidationError);
  });
});
