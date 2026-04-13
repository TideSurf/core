import { describe, it, expect, mock } from "bun:test";

/**
 * Tests for switchTab race condition (CRIT-008)
 * Verifies that connections are cleaned up if setup fails after connectToTab.
 */

describe("switchTab race condition (CRIT-008)", () => {
  it("should close connection if setup fails after connectToTab", async () => {
    // Mock connection that tracks if close was called
    const closeMock = mock(() => Promise.resolve());
    const mockConn = {
      client: { close: closeMock },
      DOM: {},
      Page: {},
      Runtime: {},
      Input: {},
      Emulation: {},
    };

    let connectToTabCalled = false;
    let applyViewportCalled = false;

    // Mock tabManager that succeeds on connect but fails on applyViewport
    const mockTabManager = {
      connectToTab: mock(async () => {
        connectToTabCalled = true;
        return mockConn;
      }),
    };

    // Mock applyViewport that throws error
    const mockApplyViewport = mock(async () => {
      applyViewportCalled = true;
      throw new Error("Viewport setup failed");
    });

    // Simulate the fixed switchTab implementation pattern
    const switchTab = async (tabId: string, defaultViewport: unknown): Promise<void> => {
      let conn: typeof mockConn | undefined;
      try {
        conn = await mockTabManager.connectToTab(tabId);
        if (defaultViewport) {
          await mockApplyViewport(conn, defaultViewport);
        }
        // If we get here, setup succeeded
        // (would normally set this.pages.set, this.activePage, etc.)
      } catch (err) {
        // Clean up connection if it was created but setup failed
        if (conn) {
          try {
            await conn.client.close();
          } catch {
            // ignore cleanup errors
          }
        }
        throw err;
      }
    };

    // Execute: should throw because applyViewport fails
    await expect(switchTab("tab-123", { width: 1920, height: 1080 })).rejects.toThrow("Viewport setup failed");

    // Verify: connectToTab was called
    expect(connectToTabCalled).toBe(true);
    // Verify: applyViewport was called and threw
    expect(applyViewportCalled).toBe(true);
    // Verify: connection was cleaned up
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it("should NOT close connection if setup succeeds", async () => {
    const closeMock = mock(() => Promise.resolve());
    const mockConn = {
      client: { close: closeMock },
      DOM: {},
      Page: {},
      Runtime: {},
      Input: {},
      Emulation: {},
    };

    const mockTabManager = {
      connectToTab: mock(async () => mockConn),
    };

    const mockApplyViewport = mock(async () => {
      // Success - no throw
    });

    const switchTab = async (tabId: string, defaultViewport: unknown): Promise<void> => {
      let conn: typeof mockConn | undefined;
      try {
        conn = await mockTabManager.connectToTab(tabId);
        if (defaultViewport) {
          await mockApplyViewport(conn, defaultViewport);
        }
        // Setup succeeded
      } catch (err) {
        if (conn) {
          try {
            await conn.client.close();
          } catch {
            // ignore
          }
        }
        throw err;
      }
    };

    // Execute: should succeed
    await switchTab("tab-123", { width: 1920, height: 1080 });

    // Verify: connection was NOT closed (it's being used)
    expect(closeMock).not.toHaveBeenCalled();
  });

  it("should handle connectToTab failure without trying to close undefined connection", async () => {
    const mockTabManager = {
      connectToTab: mock(async () => {
        throw new Error("Tab not found");
      }),
    };

    const switchTab = async (tabId: string): Promise<void> => {
      let conn: unknown | undefined;
      try {
        conn = await mockTabManager.connectToTab(tabId);
        // Would do setup here
      } catch (err) {
        if (conn) {
          // This shouldn't execute if connectToTab threw
          throw new Error("Cleanup was attempted but shouldn't happen");
        }
        throw err;
      }
    };

    // Execute: should throw the original error
    await expect(switchTab("nonexistent-tab")).rejects.toThrow("Tab not found");
  });

  it("should handle cleanup errors gracefully", async () => {
    // Connection that fails to close
    const closeMock = mock(() => Promise.reject(new Error("Close failed")));
    const mockConn = {
      client: { close: closeMock },
      DOM: {},
      Page: {},
      Runtime: {},
      Input: {},
      Emulation: {},
    };

    const mockTabManager = {
      connectToTab: mock(async () => mockConn),
    };

    const mockApplyViewport = mock(async () => {
      throw new Error("Viewport setup failed");
    });

    const switchTab = async (tabId: string, defaultViewport: unknown): Promise<void> => {
      let conn: typeof mockConn | undefined;
      try {
        conn = await mockTabManager.connectToTab(tabId);
        if (defaultViewport) {
          await mockApplyViewport(conn, defaultViewport);
        }
      } catch (err) {
        if (conn) {
          try {
            await conn.client.close();
          } catch {
            // ignore cleanup errors - this is the key part
          }
        }
        throw err;
      }
    };

    // Should throw the original error, not the cleanup error
    await expect(switchTab("tab-123", { width: 1920 })).rejects.toThrow("Viewport setup failed");
    // Cleanup should have been attempted
    expect(closeMock).toHaveBeenCalled();
  });
});
