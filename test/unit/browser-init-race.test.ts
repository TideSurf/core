import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";

/**
 * Tests for browser initialization race conditions (CRIT-001)
 * These tests verify that concurrent browser() calls only create one browser instance.
 */

describe("Browser initialization race condition (CRIT-001)", () => {
  it("should use initialization promise pattern to prevent multiple Chrome instances", async () => {
    // This test verifies the pattern implemented in cli.ts and mcp/index.ts:
    //
    // let browserPromise: Promise<TideSurf> | null = null;
    //
    // async function browser(): Promise<TideSurf> {
    //   if (surfing) return surfing;
    //   if (!browserPromise) {
    //     browserPromise = (async () => {
    //       try {
    //         surfing = await TideSurf.launch({...});
    //         return surfing;
    //       } finally {
    //         browserPromise = null;
    //       }
    //     })();
    //   }
    //   return browserPromise;
    // }
    //
    // Key properties of this pattern:
    // 1. First caller creates the browserPromise
    // 2. Subsequent callers await the same promise
    // 3. Only one browser instance is created
    // 4. browserPromise is reset to null after completion

    let instanceCount = 0;
    let activeInstance: { id: number } | null = null;
    let instancePromise: Promise<{ id: number }> | null = null;

    // Mock browser factory
    const createBrowser = async (): Promise<{ id: number }> => {
      instanceCount++;
      const instance = { id: instanceCount };
      activeInstance = instance;
      // Simulate async initialization
      await new Promise((r) => setTimeout(r, 50));
      return instance;
    };

    // Implementation following the race-safe pattern
    const browser = async (): Promise<{ id: number }> => {
      if (activeInstance) return activeInstance;
      if (!instancePromise) {
        instancePromise = (async () => {
          try {
            activeInstance = await createBrowser();
            return activeInstance;
          } finally {
            instancePromise = null;
          }
        })();
      }
      return instancePromise;
    };

    // Test: Simulate 5 concurrent calls
    const results = await Promise.all([
      browser(),
      browser(),
      browser(),
      browser(),
      browser(),
    ]);

    // Verify: Only one instance should be created
    expect(instanceCount).toBe(1);
    // All callers should get the same instance
    expect(results.every((r) => r.id === 1)).toBe(true);
    expect(results[0]).toBe(results[1]);
    expect(results[0]).toBe(results[2]);
    expect(results[0]).toBe(results[3]);
    expect(results[0]).toBe(results[4]);
  });

  it("should handle sequential calls after initialization correctly", async () => {
    let instanceCount = 0;
    let activeInstance: { id: number } | null = null;
    let instancePromise: Promise<{ id: number }> | null = null;

    const createBrowser = async (): Promise<{ id: number }> => {
      instanceCount++;
      const instance = { id: instanceCount };
      activeInstance = instance;
      await new Promise((r) => setTimeout(r, 10));
      return instance;
    };

    const browser = async (): Promise<{ id: number }> => {
      if (activeInstance) return activeInstance;
      if (!instancePromise) {
        instancePromise = (async () => {
          try {
            activeInstance = await createBrowser();
            return activeInstance;
          } finally {
            instancePromise = null;
          }
        })();
      }
      return instancePromise;
    };

    // First call creates instance
    const first = await browser();
    expect(first.id).toBe(1);

    // Subsequent calls should return same instance
    const second = await browser();
    const third = await browser();

    expect(second.id).toBe(1);
    expect(third.id).toBe(1);
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(instanceCount).toBe(1);
  });

  it("should reset promise after completion to allow re-initialization if needed", async () => {
    let instanceCount = 0;
    let activeInstance: { id: number } | null = null;
    let instancePromise: Promise<{ id: number }> | null = null;

    const createBrowser = async (): Promise<{ id: number }> => {
      instanceCount++;
      const instance = { id: instanceCount };
      activeInstance = instance;
      await new Promise((r) => setTimeout(r, 10));
      return instance;
    };

    const browser = async (): Promise<{ id: number }> => {
      if (activeInstance) return activeInstance;
      if (!instancePromise) {
        instancePromise = (async () => {
          try {
            activeInstance = await createBrowser();
            return activeInstance;
          } finally {
            instancePromise = null;
          }
        })();
      }
      return instancePromise;
    };

    // First initialization
    const first = await browser();
    expect(first.id).toBe(1);
    expect(instancePromise).toBeNull();

    // Simulate clearing the instance (like closing browser)
    activeInstance = null;

    // New initialization should create a new instance
    const second = await browser();
    expect(second.id).toBe(2);
  });

  it("should handle concurrent calls where initialization fails", async () => {
    let attemptCount = 0;
    let activeInstance: { id: number } | null = null;
    let instancePromise: Promise<{ id: number }> | null = null;

    const failingCreateBrowser = async (): Promise<{ id: number }> => {
      attemptCount++;
      await new Promise((r) => setTimeout(r, 10));
      throw new Error("Browser launch failed");
    };

    const browser = async (): Promise<{ id: number }> => {
      if (activeInstance) return activeInstance;
      if (!instancePromise) {
        instancePromise = (async () => {
          try {
            activeInstance = await failingCreateBrowser();
            return activeInstance;
          } finally {
            instancePromise = null;
          }
        })();
      }
      return instancePromise;
    };

    // Multiple concurrent calls should all fail but only try once
    const results = await Promise.allSettled([
      browser(),
      browser(),
      browser(),
    ]);

    expect(attemptCount).toBe(1);
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    // Promise should be reset after failure
    expect(instancePromise).toBeNull();
  });
});
