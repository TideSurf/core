import { withTimeout } from "../../src/cdp/timeout.js";
import { CDPTimeoutError } from "../../src/errors.js";

describe("withTimeout", () => {
  it("resolves when promise completes before timeout", async () => {
    const result = await withTimeout(
      Promise.resolve("ok"),
      1000,
      "test"
    );
    expect(result).toBe("ok");
  });

  it("rejects with CDPTimeoutError when timeout fires first", async () => {
    const slow = new Promise((resolve) => setTimeout(resolve, 5000));
    await expect(
      withTimeout(slow, 50, "slowOp")
    ).rejects.toThrow(CDPTimeoutError);
  });

  it("includes operation name in timeout error", async () => {
    const slow = new Promise((resolve) => setTimeout(resolve, 5000));
    try {
      await withTimeout(slow, 50, "getFullDOM");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CDPTimeoutError);
      expect((err as CDPTimeoutError).message).toContain("getFullDOM");
      expect((err as CDPTimeoutError).message).toContain("50ms");
    }
  });

  it("propagates the original error if promise rejects before timeout", async () => {
    const failing = Promise.reject(new Error("original error"));
    await expect(
      withTimeout(failing, 5000, "test")
    ).rejects.toThrow("original error");
  });
});
