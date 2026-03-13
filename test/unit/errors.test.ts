import { describe, it, expect } from "vitest";
import {
  TideSurfError,
  CDPConnectionError,
  CDPTimeoutError,
  ChromeLaunchError,
  ElementNotFoundError,
  NavigationError,
  ValidationError,
} from "../../src/errors.js";

describe("Error classes", () => {
  it("TideSurfError is instanceof Error", () => {
    const err = new TideSurfError("test");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(TideSurfError);
    expect(err.name).toBe("TideSurfError");
    expect(err.message).toBe("test");
  });

  it("CDPConnectionError extends TideSurfError", () => {
    const err = new CDPConnectionError("refused");
    expect(err).toBeInstanceOf(TideSurfError);
    expect(err.name).toBe("CDPConnectionError");
  });

  it("CDPTimeoutError includes operation and duration", () => {
    const err = new CDPTimeoutError("getFullDOM", 15000);
    expect(err).toBeInstanceOf(TideSurfError);
    expect(err.name).toBe("CDPTimeoutError");
    expect(err.message).toBe("getFullDOM timed out after 15000ms");
  });

  it("ChromeLaunchError extends TideSurfError", () => {
    const err = new ChromeLaunchError("not found");
    expect(err).toBeInstanceOf(TideSurfError);
    expect(err.name).toBe("ChromeLaunchError");
  });

  it("ElementNotFoundError includes element ID", () => {
    const err = new ElementNotFoundError("B5");
    expect(err).toBeInstanceOf(TideSurfError);
    expect(err.name).toBe("ElementNotFoundError");
    expect(err.message).toContain("B5");
    expect(err.message).toContain("getState()");
  });

  it("NavigationError includes URL and optional reason", () => {
    const err1 = new NavigationError("https://example.com");
    expect(err1.message).toContain("https://example.com");

    const err2 = new NavigationError("https://example.com", "net::ERR_NAME_NOT_RESOLVED");
    expect(err2.message).toContain("net::ERR_NAME_NOT_RESOLVED");
  });

  it("ValidationError extends TideSurfError", () => {
    const err = new ValidationError("invalid URL");
    expect(err).toBeInstanceOf(TideSurfError);
    expect(err.name).toBe("ValidationError");
  });

  it("preserves cause via ErrorOptions", () => {
    const cause = new Error("original");
    const err = new CDPConnectionError("wrapped", { cause });
    expect(err.cause).toBe(cause);
  });
});
