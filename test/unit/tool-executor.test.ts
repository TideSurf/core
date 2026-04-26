import { createToolExecutor } from "../../src/tools/executor.js";
import { ElementNotFoundError } from "../../src/errors.js";

describe("createToolExecutor", () => {
  it("blocks evaluate in read-only mode", async () => {
    const page = {
      evaluate: jest.fn(),
    };
    const instance = {
      getPage: () => page,
    };

    const executor = createToolExecutor(instance as never, true);
    const result = await executor({
      name: "evaluate",
      input: { expression: "document.title" },
    });

    expect(result).toEqual({
      success: false,
      error: 'Tool "evaluate" is disabled in read-only mode',
    });
    expect(page.evaluate).not.toHaveBeenCalled();
  });

  it("blocks clipboard_read in read-only mode", async () => {
    const page = {
      clipboardRead: jest.fn().mockResolvedValue("clipboard content"),
    };
    const instance = {
      getPage: () => page,
    };

    const executor = createToolExecutor(instance as never, true);
    const result = await executor({
      name: "clipboard_read",
      input: {},
    });

    expect(result).toEqual({
      success: false,
      error: 'Tool "clipboard_read" is disabled in read-only mode',
    });
    expect(page.clipboardRead).not.toHaveBeenCalled();
  });

  it("allows switch_tab in read-only mode", async () => {
    const instance = {
      getPage: () => ({}),
      switchTab: jest.fn().mockResolvedValue(undefined),
      getState: jest.fn().mockResolvedValue({ content: "switched state" }),
    };

    const executor = createToolExecutor(instance as never, true);
    const result = await executor({
      name: "switch_tab",
      input: { tabId: "tab-1" },
    });

    expect(result).toEqual({
      success: true,
      data: "Switched to tab tab-1. Page state:\n\nswitched state",
    });
    expect(instance.switchTab).toHaveBeenCalledWith("tab-1");
  });

  describe("HIGH-006: Error type preservation", () => {
    it("should include errorType in error response", async () => {
      const page = {
        click: jest.fn().mockRejectedValue(new Error("Element not found")),
      };
      const instance = {
        getPage: () => page,
      };

      const executor = createToolExecutor(instance as never, false);
      const result = await executor({
        name: "click",
        input: { id: "B1" },
      });

      expect(result.success).toBe(false);
      expect(result.errorType).toBe("Error");
      expect(result.error).toContain("Element not found");
    });

    it("should include stack trace in development mode", async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";

      const testError = new Error("Test error");
      const page = {
        click: jest.fn().mockRejectedValue(testError),
      };
      const instance = {
        getPage: () => page,
      };

      const executor = createToolExecutor(instance as never, false);
      const result = await executor({
        name: "click",
        input: { id: "B1" },
      });

      expect(result.success).toBe(false);
      expect(result.stack).toBeDefined();
      expect(result.stack).toContain("Error: Test error");

      process.env.NODE_ENV = originalEnv;
    });

    it("should not include stack trace in production", async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";

      const testError = new Error("Test error");
      const page = {
        click: jest.fn().mockRejectedValue(testError),
      };
      const instance = {
        getPage: () => page,
      };

      const executor = createToolExecutor(instance as never, false);
      const result = await executor({
        name: "click",
        input: { id: "B1" },
      });

      expect(result.success).toBe(false);
      expect(result.stack).toBeUndefined();

      process.env.NODE_ENV = originalEnv;
    });

    it("should preserve ElementNotFoundError type", async () => {
      const page = {
        click: jest.fn().mockRejectedValue(new ElementNotFoundError("B1")),
      };
      const instance = {
        getPage: () => page,
      };

      const executor = createToolExecutor(instance as never, false);
      const result = await executor({
        name: "click",
        input: { id: "B1" },
      });

      expect(result.success).toBe(false);
      expect(result.errorType).toBe("ElementNotFoundError");
    });
  });

  describe("HIGH-007: Input validation", () => {
    it("should validate element ID format for click", async () => {
      const page = {
        click: jest.fn(),
      };
      const instance = {
        getPage: () => page,
      };

      const executor = createToolExecutor(instance as never, false);
      const result = await executor({
        name: "click",
        input: { id: "invalid-id" },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid element ID");
    });

    it("should validate URL format for navigate", async () => {
      const page = {
      };
      const instance = {
        getPage: () => page,
        navigate: jest.fn().mockRejectedValue(new Error('Invalid URL: "not-a-url". Must be a valid absolute URL')),
        getState: jest.fn(),
      };

      const executor = createToolExecutor(instance as never, false);
      const result = await executor({
        name: "navigate",
        input: { url: "not-a-url" },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid URL");
    });

    it("should validate maxTokens is positive integer", async () => {
      const instance = {
        getPage: () => ({}),
        getState: jest.fn().mockResolvedValue({ content: "test" }),
      };

      const executor = createToolExecutor(instance as never, false);
      const result = await executor({
        name: "get_state",
        input: { maxTokens: -1 },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("positive integer");
    });

    it("should require text parameter for type", async () => {
      const page = {};
      const instance = {
        getPage: () => page,
      };

      const executor = createToolExecutor(instance as never, false);
      const result = await executor({
        name: "type",
        input: { id: "I1" },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Text is required");
    });
  });
});
