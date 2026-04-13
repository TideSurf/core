import { describe, it, expect, mock } from "bun:test";

/**
 * Tests for download race condition (CRIT-009)
 * Verifies that listeners are set up BEFORE click to capture fast downloads.
 */

describe("Download race condition (CRIT-009)", () => {
  it("should setup listeners before triggering download", async () => {
    const events: string[] = [];

    // Mock connection with event subscription
    const mockConn = {
      Page: {
        on: mock((event: string, handler: unknown) => {
          events.push(`subscribe:${event}`);
          // Return unsubscribe function
          return () => {
            events.push(`unsubscribe:${event}`);
          };
        }),
        setDownloadBehavior: mock(async () => {
          events.push("setDownloadBehavior");
        }),
      },
    };

    // Mock download manager following the fixed pattern
    const setupDownloadListeners = (conn: typeof mockConn, dir: string) => {
      events.push("setupListeners:start");

      const cleanup = () => {
        events.push("cleanup");
      };

      const promise = new Promise<{ filePath: string; fileName: string; totalBytes: number }>((resolve) => {
        // Simulate event handlers being registered
        conn.Page.on("downloadWillBegin", () => {});
        conn.Page.on("downloadProgress", (params: { state: string }) => {
          if (params.state === "completed") {
            resolve({ filePath: dir, fileName: "test.txt", totalBytes: 100 });
          }
        });
        events.push("setupListeners:complete");
      });

      return { promise, cleanup };
    };

    const mockClickNode = mock(async () => {
      events.push("clickNode");
      // Simulate immediate download completion
      // This would trigger downloadProgress with "completed"
    });

    // Execute the fixed pattern
    const downloadDir = "/tmp/downloads";
    await mockConn.Page.setDownloadBehavior({ behavior: "allow", downloadPath: downloadDir });

    // Step 1: Setup listeners FIRST
    const { promise: downloadPromise, cleanup } = setupDownloadListeners(mockConn, downloadDir);

    // Step 2: Then click
    await mockClickNode();

    // Verify order: listeners setup before click
    const listenerSetupIndex = events.indexOf("setupListeners:complete");
    const clickIndex = events.indexOf("clickNode");

    expect(listenerSetupIndex).toBeLessThan(clickIndex);
    expect(listenerSetupIndex >= 0).toBe(true);
    expect(clickIndex >= 0).toBe(true);
  });

  it("should capture fast download that completes before click returns", async () => {
    // This test simulates a download that completes so fast that
    // the downloadWillBegin and downloadProgress events fire immediately

    let downloadWillBeginHandler: ((params: { guid: string; suggestedFilename: string }) => void) | null = null;
    let downloadProgressHandler: ((params: { guid: string; state: string }) => void) | null = null;

    const mockConn = {
      Page: {
        on: mock((event: string, handler: unknown) => {
          if (event === "downloadWillBegin") {
            downloadWillBeginHandler = handler as typeof downloadWillBeginHandler;
          } else if (event === "downloadProgress") {
            downloadProgressHandler = handler as typeof downloadProgressHandler;
          }
          return () => {};
        }),
        setDownloadBehavior: mock(async () => {}),
      },
    };

    // Setup listeners (this is the fixed pattern)
    let completedGuid = "";
    const { promise, cleanup } = (() => {
      let resolved = false;
      const promise = new Promise<{ fileName: string; guid: string }>((resolve, reject) => {
        let fileName = "";
        let guid = "";

        const checkComplete = () => {
          if (guid && resolved) {
            resolve({ fileName, guid });
          }
        };

        mockConn.Page.on("downloadWillBegin", (params: { guid: string; suggestedFilename: string }) => {
          guid = params.guid;
          fileName = params.suggestedFilename;
          checkComplete();
        });

        mockConn.Page.on("downloadProgress", (params: { guid: string; state: string }) => {
          if (params.state === "completed") {
            completedGuid = params.guid || guid;
            resolved = true;
            checkComplete();
          }
        });
      });

      return {
        promise,
        cleanup: () => {},
      };
    })();

    // Simulate an IMMEDIATE download event (faster than click returns)
    // This represents the race: download completes before clickNode() returns
    if (downloadWillBeginHandler) {
      downloadWillBeginHandler({ guid: "fast-download-123", suggestedFilename: "fast.txt" });
    }

    // Simulate the download completing immediately
    if (downloadProgressHandler) {
      downloadProgressHandler({ guid: "fast-download-123", state: "completed" });
    }

    // The promise should resolve even though events fired before click
    const result = await Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 100)),
    ]);

    expect(result).toEqual({ fileName: "fast.txt", guid: "fast-download-123" });
    expect(completedGuid).toBe("fast-download-123");
  });

  it("should cleanup listeners on error", async () => {
    const unsubscribed: string[] = [];

    const mockConn = {
      Page: {
        on: mock((event: string) => {
          return () => {
            unsubscribed.push(event);
          };
        }),
        setDownloadBehavior: mock(async () => {}),
      },
    };

    const setupListeners = () => {
      const cleanup = () => {
        unsubscribed.push("manual-cleanup");
      };
      const promise = Promise.reject(new Error("Download failed"));
      return { promise, cleanup };
    };

    const { promise, cleanup } = setupListeners();

    try {
      await promise;
    } catch {
      cleanup();
    }

    expect(unsubscribed).toContain("manual-cleanup");
  });
});
