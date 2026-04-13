import { describe, it, expect, jest, beforeEach } from "bun:test";
import { SurfingPage } from "../../src/cdp/page.js";
import { ElementNotFoundError } from "../../src/errors.js";
import type { CDPConnection } from "../../src/cdp/connection.js";

/**
 * Mock CDP Connection for testing bug fixes
 */
function createMockCDPConnection(overrides: Partial<CDPConnection> = {}): CDPConnection {
  return {
    client: { close: jest.fn() } as unknown as CDPConnection["client"],
    DOM: {
      enable: jest.fn(),
      getDocument: jest.fn().mockResolvedValue({ root: { nodeId: 1 } }),
      resolveNode: jest.fn().mockResolvedValue({ object: { objectId: "test-1" } }),
      setFileInputFiles: jest.fn(),
      getBoxModel: jest.fn().mockResolvedValue({
        model: { content: [0, 0, 100, 0, 100, 100, 0, 100] },
      }),
    } as unknown as CDPConnection["DOM"],
    Page: {
      enable: jest.fn(),
      navigate: jest.fn(),
      loadEventFired: jest.fn(),
      captureScreenshot: jest.fn().mockResolvedValue({ data: "base64png" }),
    } as unknown as CDPConnection["Page"],
    Runtime: {
      enable: jest.fn(),
      evaluate: jest.fn().mockResolvedValue({ result: { value: "test" } }),
      callFunctionOn: jest.fn(),
      releaseObject: jest.fn(),
    } as unknown as CDPConnection["Runtime"],
    Input: {
      dispatchKeyEvent: jest.fn(),
    } as unknown as CDPConnection["Input"],
    Emulation: {} as unknown as CDPConnection["Emulation"],
    isDead: false,
    ...overrides,
  };
}

describe("CRIT-006: search() does not overwrite lastNodeMap", () => {
  it("should not modify lastNodeMap after search", async () => {
    const conn = createMockCDPConnection();
    const page = new SurfingPage(conn);

    // First, simulate getState by setting up a node map directly
    // @ts-ignore - accessing private field for testing
    page["lastNodeMap"] = new Map([
      ["B1", 100],
      ["B2", 200],
      ["L1", 300],
    ]);

    // @ts-ignore - accessing private field for testing
    const mapBefore = new Map(page["lastNodeMap"]);

    // Perform search
    await page.search("test query");

    // @ts-ignore - accessing private field for testing
    const mapAfter = page["lastNodeMap"];

    // Map should be unchanged
    expect(mapAfter.size).toBe(mapBefore.size);
    expect(mapAfter.get("B1")).toBe(100);
    expect(mapAfter.get("B2")).toBe(200);
    expect(mapAfter.get("L1")).toBe(300);
  });
});

describe("CRIT-004: Stale element ID race", () => {
  it("should throw ElementNotFoundError when node no longer exists", async () => {
    const conn = createMockCDPConnection({
      DOM: {
        enable: jest.fn(),
        getDocument: jest.fn().mockResolvedValue({ root: { nodeId: 1 } }),
        resolveNode: jest.fn().mockRejectedValue(new Error("Node not found")),
        setFileInputFiles: jest.fn(),
        getBoxModel: jest.fn(),
      } as unknown as CDPConnection["DOM"],
    });
    const page = new SurfingPage(conn);

    // Setup node map
    // @ts-ignore
    page["lastNodeMap"] = new Map([["B1", 999]]);

    // Should throw ElementNotFoundError with helpful message
    await expect(page.click("B1")).rejects.toThrow(ElementNotFoundError);
    await expect(page.click("B1")).rejects.toThrow("call get_state to refresh");
  });

  it("should release resolved object after validation", async () => {
    const releaseObject = jest.fn().mockResolvedValue(undefined);
    const conn = createMockCDPConnection({
      DOM: {
        enable: jest.fn(),
        getDocument: jest.fn().mockResolvedValue({ root: { nodeId: 1 } }),
        resolveNode: jest.fn().mockResolvedValue({ object: { objectId: "obj-123" } }),
        setFileInputFiles: jest.fn(),
        getBoxModel: jest.fn(),
      } as unknown as CDPConnection["DOM"],
      Runtime: {
        enable: jest.fn(),
        evaluate: jest.fn().mockResolvedValue({ result: { value: "test" } }),
        callFunctionOn: jest.fn(),
        releaseObject,
      } as unknown as CDPConnection["Runtime"],
    });
    const page = new SurfingPage(conn);

    // @ts-ignore
    page["lastNodeMap"] = new Map([["B1", 100]]);

    // @ts-ignore - test resolveId directly
    await page["resolveId"]("B1");

    // Should have released the object
    expect(releaseObject).toHaveBeenCalledWith({ objectId: "obj-123" });
  });
});

describe("HIGH-006: Error type preservation", () => {
  it("ElementNotFoundError should include additional context when provided", () => {
    const err = new ElementNotFoundError("B1", "Element may have changed");
    expect(err.message).toContain("B1");
    expect(err.message).toContain("Element may have changed");
    expect(err.name).toBe("ElementNotFoundError");
  });
});
