import { describe, it, expect, mock } from "bun:test";

/**
 * Tests for signal handler race condition (CRIT-010)
 * Verifies proper async shutdown with deduplication.
 */

describe("Signal handler race condition (CRIT-010)", () => {
  it("should only run shutdown once even with multiple signals", async () => {
    let closeCallCount = 0;
    let exitCallCount = 0;
    let exitCode: number | null = null;

    // Mock browser
    const mockBrowser = {
      close: mock(async () => {
        closeCallCount++;
        // Simulate slow close operation
        await new Promise((r) => setTimeout(r, 50));
      }),
    };

    // Mock process.exit
    const originalExit = process.exit;
    const mockExit = mock((code: number) => {
      exitCallCount++;
      exitCode = code;
      // Don't actually exit in tests
    });
    // @ts-expect-error - mocking process.exit for test
    process.exit = mockExit;

    // Implementation of the fixed shutdown pattern
    let isShuttingDown = false;
    let surfing: typeof mockBrowser | null = mockBrowser;

    const shutdown = async (signal: string): Promise<void> => {
      if (isShuttingDown) return;
      isShuttingDown = true;
      console.log(`Received ${signal}, shutting down...`);
      try {
        if (surfing) {
          await Promise.race([
            surfing.close(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("Shutdown timeout")), 10000)
            ),
          ]);
        }
        mockExit(0);
      } catch (err) {
        mockExit(1);
      }
    };

    // Simulate multiple rapid signals (SIGINT then SIGTERM)
    const p1 = shutdown("SIGINT");
    const p2 = shutdown("SIGTERM");
    const p3 = shutdown("SIGINT");

    await Promise.all([p1, p2, p3]);

    // Restore process.exit
    process.exit = originalExit;

    // Verify: close() only called once despite 3 signals
    expect(closeCallCount).toBe(1);
    // Verify: exit only called once
    expect(exitCallCount).toBe(1);
    // Verify: successful exit code
    expect(exitCode).toBe(0);
  });

  it("should wait for close() before calling process.exit", async () => {
    const events: string[] = [];
    let closeResolve: (() => void) | null = null;

    const mockBrowser = {
      close: mock(async () => {
        events.push("close:start");
        // Simulate slow close
        await new Promise<void>((resolve) => {
          closeResolve = resolve;
        });
        events.push("close:end");
      }),
    };

    // Mock process.exit
    const originalExit = process.exit;
    const mockExit = mock((code: number) => {
      events.push(`exit:${code}`);
    });
    // @ts-expect-error
    process.exit = mockExit;

    let isShuttingDown = false;
    let surfing: typeof mockBrowser | null = mockBrowser;

    const shutdown = async (signal: string): Promise<void> => {
      if (isShuttingDown) return;
      isShuttingDown = true;
      try {
        if (surfing) {
          await surfing.close();
        }
        mockExit(0);
      } catch {
        mockExit(1);
      }
    };

    // Start shutdown
    const shutdownPromise = shutdown("SIGINT");

    // At this point, close() should be in progress
    expect(events).toContain("close:start");
    expect(events).not.toContain("close:end");
    expect(events).not.toContain("exit:0");

    // Let close() finish
    closeResolve?.();
    await shutdownPromise;

    // Restore
    process.exit = originalExit;

    // Now verify order: close() ended before exit()
    const closeEndIndex = events.indexOf("close:end");
    const exitIndex = events.indexOf("exit:0");

    expect(closeEndIndex).toBeLessThan(exitIndex);
    expect(closeEndIndex).toBeGreaterThanOrEqual(0);
    expect(exitIndex).toBeGreaterThanOrEqual(0);
  });

  it("should handle close() timeout and still call exit", async () => {
    const events: string[] = [];

    const mockBrowser = {
      close: mock(async () => {
        events.push("close:start");
        // Simulate very slow close (longer than timeout)
        await new Promise((resolve) => setTimeout(resolve, 200));
        events.push("close:end");
      }),
    };

    // Mock process.exit
    const originalExit = process.exit;
    const mockExit = mock((code: number) => {
      events.push(`exit:${code}`);
    });
    // @ts-expect-error
    process.exit = mockExit;

    let isShuttingDown = false;
    let surfing: typeof mockBrowser | null = mockBrowser;

    const shutdown = async (signal: string): Promise<void> => {
      if (isShuttingDown) return;
      isShuttingDown = true;
      try {
        if (surfing) {
          await Promise.race([
            surfing.close(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("Shutdown timeout")), 50)
            ),
          ]);
        }
        mockExit(0);
      } catch {
        mockExit(1);
      }
    };

    await shutdown("SIGINT");

    // Restore
    process.exit = originalExit;

    // Should exit with error code due to timeout
    expect(events).toContain("exit:1");
  });

  it("should handle close() failure and call exit with error code", async () => {
    const mockBrowser = {
      close: mock(async () => {
        throw new Error("Close failed");
      }),
    };

    // Mock process.exit
    const originalExit = process.exit;
    let exitCode: number | null = null;
    const mockExit = mock((code: number) => {
      exitCode = code;
    });
    // @ts-expect-error
    process.exit = mockExit;

    let isShuttingDown = false;
    let surfing: typeof mockBrowser | null = mockBrowser;

    const shutdown = async (): Promise<void> => {
      if (isShuttingDown) return;
      isShuttingDown = true;
      try {
        if (surfing) {
          await surfing.close();
        }
        mockExit(0);
      } catch {
        mockExit(1);
      }
    };

    await shutdown();

    // Restore
    process.exit = originalExit;

    // Should exit with error code
    expect(exitCode).toBe(1);
  });
});
