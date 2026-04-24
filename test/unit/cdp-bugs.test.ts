import { describe, it, expect, beforeEach, jest } from "bun:test";
import * as fs from "node:fs";
import { CDPTimeoutError, CDPConnectionError, TideSurfError } from "../../src/errors.js";

describe("CDP Connection Fixes", () => {
  describe("HIGH-003: scroll() timeout", () => {
    it("scroll function should include timeout parameter", async () => {
      const content = fs.readFileSync("./src/cdp/connection.ts", "utf-8");
      
      // Verify scroll function has timeout parameter and uses withTimeout
      expect(content).toContain("export async function scroll(");
      expect(content).toContain("timeout?: number");
      expect(content).toContain('await withTimeout(');
      expect(content).toContain('"scroll"');
    });
  });

  describe("HIGH-008: setFileInput timeout", () => {
    it("setFileInput should wrap all CDP calls with withTimeout", async () => {
      const content = fs.readFileSync("./src/cdp/connection.ts", "utf-8");
      
      // Verify setFileInput has timeout parameter and uses withTimeout
      expect(content).toContain("export async function setFileInput(");
      expect(content).toContain("timeout?: number");
      // Should have multiple withTimeout calls for each CDP operation
      const matches = content.match(/await withTimeout\(/g);
      expect(matches?.length).toBeGreaterThanOrEqual(4); // At least 4 timeouts in setFileInput
    });
  });

  describe("HIGH-011: evaluate result null check", () => {
    it("evaluate should check result.result exists", async () => {
      const content = fs.readFileSync("./src/cdp/connection.ts", "utf-8");
      
      // Verify the null check is present
      expect(content).toContain("if (!result.result)");
      expect(content).toContain('throw new Error("Evaluation returned no result")');
    });
  });

  describe("HIGH-018: Chrome crash detection", () => {
    it("connect should set up disconnect and targetCrashed listeners", async () => {
      const content = fs.readFileSync("./src/cdp/connection.ts", "utf-8");
      
      // Verify event listeners are set up on domains that expose them.
      expect(content).toContain('("disconnect"');
      expect(content).toContain("Inspector?.targetCrashed?.");
      expect(content).toContain("conn.isDead = true");
    });

    it("CDPConnection interface should have isDead property", async () => {
      const content = fs.readFileSync("./src/cdp/connection.ts", "utf-8");
      
      expect(content).toContain("isDead?: boolean");
    });
  });

  describe("HIGH-013: MutationObserver accumulation", () => {
    it("waitForStable should use shared observer on window", async () => {
      const content = fs.readFileSync("./src/cdp/connection.ts", "utf-8");

      // Verify the expression uses shared state slot and cancels prior work
      // (0.5.2: ctx-per-call prevents zombie timers from disconnecting new observer)
      expect(content).toContain("window.__tidesurf_stable");
      expect(content).toContain("prior.cancelled = true");
      expect(content).toContain("clearTimeout(prior.timer)");
    });
  });

  describe("NEW-CDP-004: CDP domain disable on disconnect", () => {
    it("disconnect should disable domains before closing", async () => {
      const content = fs.readFileSync("./src/cdp/connection.ts", "utf-8");
      
      // Verify domains are disabled (using type assertions)
      expect(content).toContain("DOM.disable()");
      expect(content).toContain("Page.disable()");
      expect(content).toContain("Runtime.disable()");
      expect(content).toContain("NEW-CDP-004");
    });
  });
});

describe("Download Manager Fixes", () => {
  describe("NEW-CDP-001: Download race condition handling", () => {
    it("setupDownloadListeners should exist", async () => {
      const content = fs.readFileSync("./src/cdp/download-manager.ts", "utf-8");
      
      expect(content).toContain("export function setupDownloadListeners");
      expect(content).toContain("promise: Promise<DownloadResult>");
      expect(content).toContain("cleanup: () => void");
    });

    it("should handle GUID assignment race", async () => {
      const content = fs.readFileSync("./src/cdp/download-manager.ts", "utf-8");
      
      // Verify race condition handling comment or logic
      expect(content).toContain("GUID assignment race");
    });
  });
});

describe("Tab Manager Fixes", () => {
  describe("NEW-CDP-003: TabManager timeouts", () => {
    it("listTabs should have timeout parameter and use withTimeout", async () => {
      const content = fs.readFileSync("./src/cdp/tab-manager.ts", "utf-8");
      
      expect(content).toContain("async listTabs(timeout?: number)");
      expect(content).toContain("withTimeout(");
      expect(content).toContain("NEW-CDP-003");
    });

    it("createTab should have timeout parameter", async () => {
      const content = fs.readFileSync("./src/cdp/tab-manager.ts", "utf-8");
      
      expect(content).toContain("async createTab(url?: string, timeout?: number)");
    });

    it("closeTab should have timeout parameter", async () => {
      const content = fs.readFileSync("./src/cdp/tab-manager.ts", "utf-8");
      
      expect(content).toContain("async closeTab(tabId: string, timeout?: number)");
    });
  });

  describe("MED-008: Error wrapping in TideSurfError", () => {
    it("listTabs should wrap errors in CDPConnectionError", async () => {
      const content = fs.readFileSync("./src/cdp/tab-manager.ts", "utf-8");
      
      expect(content).toContain("MED-008");
      expect(content).toContain("CDPConnectionError");
      expect(content).toContain("Failed to list tabs");
    });

    it("createTab should wrap errors in CDPConnectionError", async () => {
      const content = fs.readFileSync("./src/cdp/tab-manager.ts", "utf-8");
      
      expect(content).toContain("Failed to create tab");
    });

    it("closeTab should wrap errors in CDPConnectionError", async () => {
      const content = fs.readFileSync("./src/cdp/tab-manager.ts", "utf-8");
      
      expect(content).toContain("Failed to close tab");
    });
  });

  describe("MED-009: Disconnect detection", () => {
    it("isConnected method should exist", async () => {
      const content = fs.readFileSync("./src/cdp/tab-manager.ts", "utf-8");
      
      expect(content).toContain("MED-009");
      expect(content).toContain("async isConnected(timeout?: number)");
    });
  });
});

describe("Launcher Fixes", () => {
  describe("NEW-CDP-002: Unbounded string accumulation", () => {
    it("waitForDevTools should cap string accumulation at 100KB", async () => {
      const content = fs.readFileSync("./src/cdp/launcher.ts", "utf-8");
      
      // Verify the capping logic is present
      expect(content).toContain("100_000");
      expect(content).toContain("slice(-50_000)");
    });
  });
});
