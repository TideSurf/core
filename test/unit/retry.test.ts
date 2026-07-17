import { withRetry } from "../../src/cdp/retry.js";
import {
  ActionCommittedError,
  CDPConnectionError,
  CDPTimeoutError,
  ValidationError,
} from "../../src/errors.js";

describe("withRetry", () => {
  it("returns result on first success", async () => {
    const fn = jest.fn().mockResolvedValue("ok");
    const result = await withRetry(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on failure and succeeds", async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new CDPConnectionError("fail"))
      .mockResolvedValue("ok");

    const result = await withRetry(fn, {
      maxAttempts: 3,
      initialDelayMs: 10,
    });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws after max attempts", async () => {
    const fn = jest.fn().mockRejectedValue(new CDPConnectionError("fail"));

    await expect(
      withRetry(fn, { maxAttempts: 3, initialDelayMs: 10 })
    ).rejects.toThrow(CDPConnectionError);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("retries CDPTimeoutError by default (pre-mutation timeouts are safe)", async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new CDPTimeoutError("op", 1000))
      .mockResolvedValue("ok");

    const result = await withRetry(fn, { maxAttempts: 3, initialDelayMs: 10 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry ActionCommittedError by default (side effects may have committed)", async () => {
    const fn = jest
      .fn()
      .mockRejectedValue(new ActionCommittedError("Click", new Error("boom")));

    await expect(
      withRetry(fn, { maxAttempts: 3, initialDelayMs: 10 })
    ).rejects.toThrow(ActionCommittedError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry deterministic errors by default", async () => {
    const fn = jest.fn().mockRejectedValue(new ValidationError("bad input"));

    await expect(
      withRetry(fn, { maxAttempts: 3, initialDelayMs: 10 })
    ).rejects.toThrow(ValidationError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("respects custom retryable predicate", async () => {
    const fn = jest.fn().mockRejectedValue(new Error("custom"));

    await expect(
      withRetry(fn, {
        maxAttempts: 3,
        initialDelayMs: 10,
        retryable: () => false,
      })
    ).rejects.toThrow("custom");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("applies exponential backoff", async () => {
    const timestamps: number[] = [];
    const fn = jest.fn().mockImplementation(async () => {
      timestamps.push(Date.now());
      if (timestamps.length < 3) throw new CDPConnectionError("fail");
      return "ok";
    });

    await withRetry(fn, {
      maxAttempts: 3,
      initialDelayMs: 50,
      backoffFactor: 2,
    });

    expect(fn).toHaveBeenCalledTimes(3);
    // Second delay should be longer than first
    const delay1 = timestamps[1] - timestamps[0];
    const delay2 = timestamps[2] - timestamps[1];
    expect(delay2).toBeGreaterThanOrEqual(delay1 * 1.5); // Allow some tolerance
  });

  it.each([
    { maxAttempts: 0 },
    { maxAttempts: 1.5 },
    { maxAttempts: Number.MAX_SAFE_INTEGER + 1 },
    { initialDelayMs: -1 },
    { initialDelayMs: Number.NaN },
    { initialDelayMs: 2_147_483_648 },
    { backoffFactor: 0 },
    { backoffFactor: Number.POSITIVE_INFINITY },
    { maxAttempts: 3, initialDelayMs: 1_500_000_000, backoffFactor: 2 },
  ])("rejects invalid retry options before calling the task", async (options) => {
    const fn = jest.fn().mockResolvedValue("unexpected");

    await expect(withRetry(fn, options)).rejects.toBeInstanceOf(ValidationError);
    expect(fn).not.toHaveBeenCalled();
  });
});
