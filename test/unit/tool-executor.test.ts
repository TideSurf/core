import { describe, expect, it, vi } from "vitest";
import { createToolExecutor } from "../../src/tools/executor.js";

describe("createToolExecutor", () => {
  it("blocks evaluate in read-only mode", async () => {
    const page = {
      evaluate: vi.fn(),
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
      clipboardRead: vi.fn(),
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
});
