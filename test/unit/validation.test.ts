import { describe, it, expect } from "vitest";
import {
  validateUrl,
  validateSelector,
  validateExpression,
  validateElementId,
  validatePort,
  validateFilePath,
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

describe("validatePort", () => {
  it("accepts valid ports", () => {
    expect(() => validatePort(1)).not.toThrow();
    expect(() => validatePort(80)).not.toThrow();
    expect(() => validatePort(9222)).not.toThrow();
    expect(() => validatePort(65535)).not.toThrow();
  });

  it("rejects port 0", () => {
    expect(() => validatePort(0)).toThrow(ValidationError);
  });

  it("rejects negative ports", () => {
    expect(() => validatePort(-1)).toThrow(ValidationError);
  });

  it("rejects ports above 65535", () => {
    expect(() => validatePort(99999)).toThrow(ValidationError);
  });

  it("rejects NaN", () => {
    expect(() => validatePort(NaN)).toThrow(ValidationError);
  });

  it("rejects floats", () => {
    expect(() => validatePort(80.5)).toThrow(ValidationError);
  });
});

describe("validateFilePath", () => {
  it("accepts non-empty strings", () => {
    expect(() => validateFilePath("/tmp/file.txt")).not.toThrow();
    expect(() => validateFilePath("relative/path.png")).not.toThrow();
  });

  it("rejects empty string", () => {
    expect(() => validateFilePath("")).toThrow(ValidationError);
  });

  it("rejects undefined (via type coercion)", () => {
    expect(() => validateFilePath(undefined as unknown as string)).toThrow(
      ValidationError
    );
  });
});
