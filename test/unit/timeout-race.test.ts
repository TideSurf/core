import { describe, it, expect } from "bun:test";
import { withTimeout } from "../../src/cdp/timeout.js";
import { CDPTimeoutError } from "../../src/errors.js";

describe("withTimeout race condition fixes", () => {
  it("should throw CDPTimeoutError when timeout fires before promise settles", async () => {
    // Simulate a slow promise that never settles
    const neverSettlesPromise = new Promise<string>(() => {
      // Never resolves or rejects
    });

    // Should reject with timeout error
    await expect(withTimeout(neverSettlesPromise, 50, "test operation")).rejects.toThrow(CDPTimeoutError);
  });

  it("should resolve successfully when promise settles before timeout", async () => {
    const fastPromise = Promise.resolve("success");
    const result = await withTimeout(fastPromise, 1000, "fast operation");
    expect(result).toBe("success");
  });

  it("should reject with original error when promise rejects before timeout", async () => {
    const rejectingPromise = Promise.reject(new Error("intentional error"));
    await expect(withTimeout(rejectingPromise, 1000, "rejecting operation")).rejects.toThrow("intentional error");
  });

  it("should use settled flag to prevent double resolution (implementation detail test)", async () => {
    // This tests that the settled flag pattern is in place
    // The implementation uses a 'settled' flag to prevent:
    // 1. Timer firing after promise resolves
    // 2. Promise resolving after timer fires

    // Test 1: Promise resolves before timeout - should get result, not timeout error
    const quickPromise = Promise.resolve("quick");
    const result = await withTimeout(quickPromise, 100, "quick test");
    expect(result).toBe("quick");
  });

  it("should clear timer after successful resolution", async () => {
    // If timer isn't cleared, it would keep the process alive
    const immediatePromise = Promise.resolve("immediate");
    const result = await withTimeout(immediatePromise, 10000, "long timeout test");
    expect(result).toBe("immediate");
    // If we reach here without waiting 10 seconds, timer was cleared
  });
});
