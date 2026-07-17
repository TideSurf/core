import { describe, it, expect, jest } from "bun:test";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SurfingPage, isSurfingPageConnected } from "../../src/cdp/page.js";
import type { TabManager } from "../../src/cdp/tab-manager.js";
import { TideSurf } from "../../src/tidesurf.js";
import {
  CDPConnectionError,
  CDPTimeoutError,
  ChromeLaunchError,
  ElementNotFoundError,
  ReadOnlyError,
  ValidationError,
} from "../../src/errors.js";
import type { CDPConnection } from "../../src/cdp/connection.js";
import { SNAPSHOT_COMPUTED_STYLES } from "../../src/cdp/snapshot.js";
import {
  executeValidatedToolSpec,
  getToolSpec,
} from "../../src/tools/registry.js";

function snapshotData(text = "test") {
  const strings: string[] = [];
  const indices = new Map<string, number>();
  const stringIndex = (value: string): number => {
    if (value === "") return -1;
    const cached = indices.get(value);
    if (cached !== undefined) return cached;
    const index = strings.length;
    strings.push(value);
    indices.set(value, index);
    return index;
  };
  const styleValues: Record<string, string> = {
    display: "block",
    visibility: "visible",
    opacity: "1",
    "content-visibility": "visible",
    "clip-path": "none",
    "overflow-x": "visible",
    "overflow-y": "visible",
    "pointer-events": "auto",
    contain: "none",
    clip: "auto",
    position: "static",
  };
  const style = SNAPSHOT_COMPUTED_STYLES.map((name) =>
    stringIndex(styleValues[name])
  );
  const names = ["#document", "HTML", "BODY", "BUTTON", "#text"];

  return {
    strings,
    documents: [{
      documentURL: stringIndex("https://example.com/"),
      title: stringIndex("Example"),
      frameId: stringIndex("main"),
      scrollOffsetX: 0,
      scrollOffsetY: 0,
      contentWidth: 800,
      contentHeight: 600,
      nodes: {
        parentIndex: [-1, 0, 1, 2, 3],
        nodeType: [9, 1, 1, 1, 3],
        nodeName: names.map(stringIndex),
        nodeValue: ["", "", "", "", text].map(stringIndex),
        backendNodeId: [1, 2, 3, 4, 5],
        attributes: names.map(() => []),
      },
      layout: {
        nodeIndex: [0, 1, 2, 3, 4],
        styles: names.map(() => style),
        bounds: names.map(() => [0, 0, 800, 20]),
      },
    }],
  };
}

function preflightResult() {
  return {
    result: {
      value: {
        nodeCount: 5,
        characterCount: 100,
        viewportWidth: 800,
        viewportHeight: 600,
      },
    },
  };
}

function createMockCDPConnection(overrides: Partial<CDPConnection> = {}): CDPConnection {
  return {
    client: Object.assign(new EventEmitter(), {
      close: jest.fn(),
      send: jest.fn().mockResolvedValue(snapshotData()),
    }) as unknown as CDPConnection["client"],
    DOM: {
      enable: jest.fn(),
      getDocument: jest.fn().mockResolvedValue({ root: { nodeId: 1 } }),
      resolveNode: jest.fn().mockResolvedValue({ object: { objectId: "test-1" } }),
      setFileInputFiles: jest.fn(),
      getBoxModel: jest.fn().mockResolvedValue({
        model: { content: [0, 0, 100, 0, 100, 100, 0, 100] },
      }),
    } as unknown as CDPConnection["DOM"],
    Page: {
      enable: jest.fn(),
      navigate: jest.fn(),
      lifecycleEvent: jest.fn(() => () => {}),
      captureScreenshot: jest.fn().mockResolvedValue({ data: "base64png" }),
    } as unknown as CDPConnection["Page"],
    Runtime: {
      enable: jest.fn(),
      evaluate: jest.fn(async ({ expression }: { expression: string }) =>
        expression.includes("const stack = [document]")
          ? preflightResult()
          : { result: { value: "test" } }
      ),
      callFunctionOn: jest.fn().mockResolvedValue({}),
      releaseObject: jest.fn(),
    } as unknown as CDPConnection["Runtime"],
    Emulation: {} as unknown as CDPConnection["Emulation"],
    ...overrides,
  };
}

function setNodeMap(page: SurfingPage, entries: Array<[string, number]>): void {
  (page as unknown as { lastNodeMap: Map<string, number> }).lastNodeMap =
    new Map(entries);
}

function getNodeMap(page: SurfingPage): Map<string, number> {
  return (page as unknown as { lastNodeMap: Map<string, number> }).lastNodeMap;
}

describe("search node-map preservation", () => {
  it("truncates snippets without splitting a grapheme", async () => {
    const expected = `${"a".repeat(99)}😀`;
    const page = new SurfingPage(
      createMockCDPConnection({
        client: {
          close: jest.fn(),
          send: jest.fn().mockResolvedValue(snapshotData(`${expected}tail`)),
        } as unknown as CDPConnection["client"],
      })
    );

    const results = await page.search("aaaa", 1);
    expect(results[0].text).toBe(expected);
  });

  it("should not modify lastNodeMap after search", async () => {
    const conn = createMockCDPConnection();
    const page = new SurfingPage(conn);

    setNodeMap(page, [
      ["B1", 100],
      ["B2", 200],
      ["L1", 300],
    ]);
    const mapBefore = new Map(getNodeMap(page));
    await page.search("test query");
    const mapAfter = getNodeMap(page);
    expect(mapAfter.size).toBe(mapBefore.size);
    expect(mapAfter.get("B1")).toBe(100);
    expect(mapAfter.get("B2")).toBe(200);
    expect(mapAfter.get("L1")).toBe(300);
  });

  it("serializes page snapshots without blocking actions", async () => {
    let releaseFirstInspection!: () => void;
    const firstInspectionGate = new Promise<void>((resolve) => {
      releaseFirstInspection = resolve;
    });
    let inspectionCalls = 0;
    const runtimeEvaluate = jest.fn(async ({ expression }: { expression: string }) => {
        if (expression.includes("const stack = [document]")) {
          inspectionCalls++;
          if (inspectionCalls === 1) await firstInspectionGate;
          return preflightResult();
        }
        return { result: { value: undefined } };
      });
    const conn = createMockCDPConnection({
      DOM: {
        resolveNode: jest.fn().mockResolvedValue({
          object: { objectId: "button-1" },
        }),
      } as unknown as CDPConnection["DOM"],
      Runtime: {
        evaluate: runtimeEvaluate,
        callFunctionOn: jest.fn().mockResolvedValue({
          result: { value: true },
        }),
        releaseObject: jest.fn().mockResolvedValue(undefined),
      } as unknown as CDPConnection["Runtime"],
    });
    const page = new SurfingPage(conn);
    setNodeMap(page, [["B1", 1]]);

    const state = page.readPage({ includeHidden: true });
    while (inspectionCalls === 0) await Promise.resolve();
    const search = page.search("example");
    await Promise.resolve();
    expect(inspectionCalls).toBe(1);

    await expect(page.click("B1")).resolves.toBeUndefined();
    expect(inspectionCalls).toBe(1);

    releaseFirstInspection();
    await expect(Promise.all([state, search])).resolves.toHaveLength(2);
    expect(inspectionCalls).toBe(2);
  });
});

describe("Stale element handling", () => {
  it("translates a stale mapped node into ElementNotFoundError with the recovery hint", async () => {
    const resolveNode = jest.fn().mockRejectedValue(new Error("Node not found"));
    const conn = createMockCDPConnection({
      DOM: {
        enable: jest.fn(),
        getDocument: jest.fn().mockResolvedValue({ root: { nodeId: 1 } }),
        resolveNode,
        setFileInputFiles: jest.fn(),
        getBoxModel: jest.fn(),
      } as unknown as CDPConnection["DOM"],
    });
    const page = new SurfingPage(conn);

    setNodeMap(page, [["B1", 999]]);

    await expect(page.click("B1")).rejects.toThrow(
      /Read the page again to refresh its action IDs/
    );
    expect(resolveNode).toHaveBeenCalledTimes(1);
  });

  it("resolves once and releases the action's remote object", async () => {
    const releaseObject = jest.fn().mockResolvedValue(undefined);
    const resolveNode = jest.fn().mockResolvedValue({ object: { objectId: "obj-123" } });
    const conn = createMockCDPConnection({
      DOM: {
        enable: jest.fn(),
        getDocument: jest.fn().mockResolvedValue({ root: { nodeId: 1 } }),
        resolveNode,
        setFileInputFiles: jest.fn(),
        getBoxModel: jest.fn(),
      } as unknown as CDPConnection["DOM"],
      Runtime: {
        enable: jest.fn(),
        evaluate: jest.fn().mockResolvedValue({ result: { value: "test" } }),
        callFunctionOn: jest.fn().mockResolvedValue({}),
        releaseObject,
      } as unknown as CDPConnection["Runtime"],
    });
    const page = new SurfingPage(conn);

    setNodeMap(page, [["B1", 100]]);

    await page.click("B1");

    expect(resolveNode).toHaveBeenCalledTimes(1);
    expect(releaseObject).toHaveBeenCalledWith({ objectId: "obj-123" });
  });

  it("rejects a detached mapped node before using it", async () => {
    const callFunctionOn = jest.fn().mockResolvedValue({
      result: { value: false },
    });
    const releaseObject = jest.fn().mockResolvedValue(undefined);
    const conn = createMockCDPConnection({
      Runtime: {
        enable: jest.fn(),
        evaluate: jest.fn(),
        callFunctionOn,
        releaseObject,
      } as unknown as CDPConnection["Runtime"],
    });
    const page = new SurfingPage(conn);

    setNodeMap(page, [["B1", 100]]);

    await expect(page.click("B1")).rejects.toBeInstanceOf(ElementNotFoundError);
    expect(callFunctionOn).toHaveBeenCalledTimes(1);
    expect(releaseObject).toHaveBeenCalledWith({ objectId: "test-1" });
  });
});

describe("error type preservation", () => {
  it("ElementNotFoundError should include additional context when provided", () => {
    const err = new ElementNotFoundError("B1", "Element may have changed");
    expect(err.message).toContain("B1");
    expect(err.message).toContain("Element may have changed");
    expect(err.name).toBe("ElementNotFoundError");
  });
});

describe("SurfingPage read-only enforcement", () => {
  it("blocks mutation and sensitive methods reached through getPage()", async () => {
    const page = new SurfingPage(createMockCDPConnection(), undefined, {}, true);
    const operations = [
      () => page.click("B1"),
      () => page.type("I1", "text"),
      () => page.select("S1", "value"),
      () => page.scroll("down"),
      () => page.navigate("https://example.com"),
      () => page.evaluate("1 + 1"),
      () => page.upload("I1", ["/tmp/file"]),
      () => page.clipboardRead(),
      () => page.clipboardWrite("text"),
      () => page.download("L1"),
    ];

    for (const operation of operations) {
      await expect(operation()).rejects.toBeInstanceOf(ReadOnlyError);
    }
  });
});

describe("SurfingPage runtime validation", () => {
  it("validates and copies page-read options before capture", async () => {
    const send = jest.fn().mockResolvedValue(snapshotData());
    const page = new SurfingPage(createMockCDPConnection({
      client: { close: jest.fn(), send } as unknown as CDPConnection["client"],
    }));

    await expect(
      page.readPage({ maxTokens: 0 })
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      page.readPage({ viewport: "yes" as unknown as boolean })
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      page.readPage({ mode: "verbose" as "full" })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(send).not.toHaveBeenCalled();

    const options = { viewport: false };
    const reading = page.readPage(options);
    options.viewport = true;
    const state = await reading;
    expect(state.content).not.toContain("scroll:");
  });

  it("does not expose the internal action ID map", async () => {
    const resolveNode = jest.fn().mockResolvedValue({
      object: { objectId: "button-4" },
    });
    const page = new SurfingPage(createMockCDPConnection({
      DOM: { resolveNode } as unknown as CDPConnection["DOM"],
      Runtime: {
        evaluate: jest.fn(async ({ expression }: { expression: string }) =>
          expression.includes("const stack = [document]")
            ? preflightResult()
            : { result: { value: undefined } }
        ),
        callFunctionOn: jest.fn().mockResolvedValue({ result: { value: true } }),
        releaseObject: jest.fn().mockResolvedValue(undefined),
      } as unknown as CDPConnection["Runtime"],
    }));

    const state = await page.readPage({ includeHidden: true });
    expect(state.nodeMap.get("B1")).toBe(4);
    state.nodeMap.clear();

    await page.click("B1");
    expect(resolveNode).toHaveBeenCalledWith({ backendNodeId: 4 });
  });

  it("keeps getState as a compatibility alias for readPage", async () => {
    const page = new SurfingPage(createMockCDPConnection());
    const preferred = await page.readPage({ includeHidden: true });
    const compatibility = await page.getState({ includeHidden: true });

    expect(compatibility.content).toBe(preferred.content);
    expect(compatibility.nodeMap).not.toBe(preferred.nodeMap);
  });

  it("rejects invalid scroll directions from direct JavaScript callers", async () => {
    const evaluate = jest.fn();
    const page = new SurfingPage(
      createMockCDPConnection({
        Runtime: { evaluate } as unknown as CDPConnection["Runtime"],
      })
    );

    await expect(
      page.scroll("sideways" as unknown as "up")
    ).rejects.toBeInstanceOf(ValidationError);
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("rejects invalid runtime timeouts and viewports before browser setup", async () => {
    await expect(
      TideSurf.connect(null as never)
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(TideSurf.connect({ timeout: 0 })).rejects.toBeInstanceOf(
      ValidationError
    );
    await expect(
      TideSurf.connect({ timeout: 2_147_483_648 })
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      TideSurf.launch({ defaultViewport: { width: 1280, height: -1 } })
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      TideSurf.launch({ defaultViewport: { width: 4_000, height: 4_000 } })
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(TideSurf.launch({ chromePath: "" })).rejects.toBeInstanceOf(
      ValidationError
    );
    await expect(TideSurf.launch({ userDataDir: "" })).rejects.toBeInstanceOf(
      ValidationError
    );
    await expect(
      TideSurf.connect({ host: "" })
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      TideSurf.launch({ readOnly: "yes" as unknown as boolean })
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      TideSurf.connect({ fileAccessRoots: "." as unknown as string[] })
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      TideSurf.launch({ channel: "nightly" as "stable" })
    ).rejects.toBeInstanceOf(ValidationError);

    const evaluate = jest.fn();
    const page = new SurfingPage(
      createMockCDPConnection({
        Runtime: { evaluate } as unknown as CDPConnection["Runtime"],
      })
    );
    await expect(page.waitForStable(0)).rejects.toBeInstanceOf(ValidationError);
    await expect(
      page.waitForStable(2_147_483_648)
    ).rejects.toBeInstanceOf(ValidationError);
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("copies caller-owned URL policy options", async () => {
    const options = { allowLocalhost: false };
    const conn = createMockCDPConnection();
    const page = new SurfingPage(conn, undefined, options);
    options.allowLocalhost = true;

    await expect(page.navigate("http://127.0.0.1/")).rejects.toBeInstanceOf(
      ValidationError
    );
    expect(conn.Page.navigate).not.toHaveBeenCalled();
  });

  it("copies caller-owned file access roots", async () => {
    const allowedRoot = mkdtempSync(join(tmpdir(), "tidesurf-page-allowed-"));
    const outsideRoot = mkdtempSync(join(tmpdir(), "tidesurf-page-outside-"));
    const outsideFile = join(outsideRoot, "outside.txt");
    writeFileSync(outsideFile, "outside");
    const roots = [allowedRoot];
    const page = new SurfingPage(createMockCDPConnection(), roots);
    roots.push(outsideRoot);

    try {
      await expect(page.upload("I1", [outsideFile])).rejects.toBeInstanceOf(
        ValidationError
      );
    } finally {
      rmSync(allowedRoot, { recursive: true, force: true });
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  });

  it("blocks implicit downloads when file access roots are empty", async () => {
    const conn = createMockCDPConnection();
    const page = new SurfingPage(conn, []);
    setNodeMap(page, [["L1", 100]]);

    await expect(page.download("L1")).rejects.toBeInstanceOf(ValidationError);
    expect(conn.DOM.resolveNode).not.toHaveBeenCalled();
  });

  it("rejects empty screenshot IDs and download directories", async () => {
    const conn = createMockCDPConnection();
    const page = new SurfingPage(conn);
    setNodeMap(page, [["L1", 100]]);

    await expect(page.screenshot({ elementId: "" })).rejects.toBeInstanceOf(
      ValidationError
    );
    await expect(
      page.download("L1", { downloadDir: "" })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(conn.DOM.getBoxModel).not.toHaveBeenCalled();
    expect(conn.DOM.resolveNode).not.toHaveBeenCalled();
  });

  it("captures an element's full border box", async () => {
    const captureScreenshot = jest.fn().mockResolvedValue({ data: "base64png" });
    const conn = createMockCDPConnection({
      DOM: {
        getBoxModel: jest.fn().mockResolvedValue({
          model: {
            content: [8, 3, 112, 3, 112, 57, 8, 57],
            border: [0, 0, 120, 0, 120, 60, 0, 60],
          },
        }),
      } as unknown as CDPConnection["DOM"],
      Page: { captureScreenshot } as unknown as CDPConnection["Page"],
    });
    const page = new SurfingPage(conn);
    setNodeMap(page, [["B1", 100]]);

    await expect(page.screenshot({ elementId: "B1" })).resolves.toBe(
      "base64png"
    );
    expect(captureScreenshot).toHaveBeenCalledWith({
      format: "png",
      clip: { x: 0, y: 0, width: 120, height: 60, scale: 1 },
      captureBeyondViewport: true,
    });
  });

  it("offsets an element clip by the visual viewport scroll position", async () => {
    const captureScreenshot = jest.fn().mockResolvedValue({ data: "base64png" });
    const send = jest.fn(async (method: string) =>
      method === "Page.getLayoutMetrics"
        ? { visualViewport: { pageLeft: 30, pageTop: 500 } }
        : snapshotData()
    );
    const conn = createMockCDPConnection({
      client: Object.assign(new EventEmitter(), {
        close: jest.fn(),
        send,
      }) as unknown as CDPConnection["client"],
      DOM: {
        getBoxModel: jest.fn().mockResolvedValue({
          model: { border: [8, 3, 112, 3, 112, 57, 8, 57] },
        }),
      } as unknown as CDPConnection["DOM"],
      Page: { captureScreenshot } as unknown as CDPConnection["Page"],
    });
    const page = new SurfingPage(conn);
    setNodeMap(page, [["B1", 100]]);

    // getBoxModel quads are viewport-relative; captureBeyondViewport clips in
    // page coordinates, so a scrolled page must add pageLeft/pageTop.
    await expect(page.screenshot({ elementId: "B1" })).resolves.toBe(
      "base64png"
    );
    expect(send).toHaveBeenCalledWith("Page.getLayoutMetrics");
    expect(captureScreenshot).toHaveBeenCalledWith({
      format: "png",
      clip: { x: 38, y: 503, width: 104, height: 54, scale: 1 },
      captureBeyondViewport: true,
    });
  });

  it("prefers cssVisualViewport offsets when both viewports are reported", async () => {
    const captureScreenshot = jest.fn().mockResolvedValue({ data: "base64png" });
    const send = jest.fn(async (method: string) =>
      method === "Page.getLayoutMetrics"
        ? {
            cssVisualViewport: { pageLeft: 5, pageTop: 7 },
            visualViewport: { pageLeft: 100, pageTop: 200 },
          }
        : snapshotData()
    );
    const conn = createMockCDPConnection({
      client: Object.assign(new EventEmitter(), {
        close: jest.fn(),
        send,
      }) as unknown as CDPConnection["client"],
      DOM: {
        getBoxModel: jest.fn().mockResolvedValue({
          model: { border: [8, 3, 112, 3, 112, 57, 8, 57] },
        }),
      } as unknown as CDPConnection["DOM"],
      Page: { captureScreenshot } as unknown as CDPConnection["Page"],
    });
    const page = new SurfingPage(conn);
    setNodeMap(page, [["B1", 100]]);

    await expect(page.screenshot({ elementId: "B1" })).resolves.toBe(
      "base64png"
    );
    expect(captureScreenshot).toHaveBeenCalledWith({
      format: "png",
      clip: { x: 13, y: 10, width: 104, height: 54, scale: 1 },
      captureBeyondViewport: true,
    });
  });
});

function closableConnection(): CDPConnection {
  return createMockCDPConnection({
    client: Object.assign(new EventEmitter(), {
      close: jest.fn(async () => {}),
      send: jest.fn().mockResolvedValue(snapshotData()),
    }) as unknown as CDPConnection["client"],
  });
}

function constructTideSurf(
  tabManager: unknown,
  options: { process?: ChildProcess; page?: SurfingPage } = {}
): TideSurf {
  return Reflect.construct(TideSurf, [
    options.process ?? null,
    options.page ?? new SurfingPage(closableConnection()),
    tabManager as TabManager,
    "",
    false,
    false,
    "active",
    undefined,
    [],
    {},
    undefined,
    "127.0.0.1",
    9222,
  ]) as TideSurf;
}

describe("tool failure guidance", () => {
  const getState = getToolSpec("get_state")!;
  const failingInstance = (error: Error): TideSurf =>
    ({
      readPage: async () => {
        throw error;
      },
    }) as unknown as TideSurf;

  it("appends loading guidance to timeout failures", async () => {
    const result = await executeValidatedToolSpec(
      failingInstance(new CDPTimeoutError("Page read", 5000)),
      getState,
      {}
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Page read timed out after 5000ms");
    expect(result.error).toContain(
      "The page may still be loading. Call get_state to check the current state, or retry."
    );
  });

  it("appends Chrome setup guidance to connection and launch failures", async () => {
    for (const error of [
      new CDPConnectionError("WebSocket is not open"),
      new ChromeLaunchError("Chrome executable not found"),
    ]) {
      const result = await executeValidatedToolSpec(
        failingInstance(error),
        getState,
        {}
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain(error.message);
      expect(result.error).toContain("Make sure Chrome is installed");
      expect(result.error).toContain("chrome://inspect#remote-debugging");
    }
  });

  it("keeps other failure messages unchanged", async () => {
    const result = await executeValidatedToolSpec(
      failingInstance(new Error("boom")),
      getState,
      {}
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("boom");
  });
});

describe("closeTab successor promotion", () => {
  it("does not promote a disconnected cached page as the new active page", async () => {
    const tabManager = {
      listTabs: jest.fn().mockResolvedValue([
        { id: "active", url: "about:blank", title: "", type: "page" },
        { id: "next", url: "about:blank", title: "", type: "page" },
      ]),
      connectToTab: jest.fn(async () => closableConnection()),
      closeTab: jest.fn(async () => {}),
    };
    const surf = constructTideSurf(tabManager);
    const staleConnection = closableConnection();
    const stalePage = new SurfingPage(staleConnection);
    Reflect.set(staleConnection, "disconnected", true);
    (Reflect.get(surf, "pages") as Map<string, SurfingPage>).set(
      "next",
      stalePage
    );
    expect(isSurfingPageConnected(stalePage)).toBe(false);

    await surf.closeTab("active");

    expect(Reflect.get(surf, "activeTabId")).toBe("next");
    expect(surf.getPage()).not.toBe(stalePage);
    expect(isSurfingPageConnected(surf.getPage())).toBe(true);
    expect(tabManager.connectToTab).toHaveBeenCalledWith("next", undefined);
    await surf.close();
  });
});

describe("owned Chrome exit handler", () => {
  it("swallows kill failures at process exit", async () => {
    const kill = jest.fn(() => {
      throw new Error("kill EPERM");
    });
    const proc = {
      exitCode: null,
      signalCode: null,
      kill,
    } as unknown as ChildProcess;
    const surf = constructTideSurf({}, { process: proc });

    const handler = Reflect.get(surf, "exitHandler") as () => void;
    expect(typeof handler).toBe("function");
    expect(() => handler()).not.toThrow();
    expect(kill).toHaveBeenCalledTimes(1);

    Reflect.set(proc, "exitCode", 0);
    await surf.close();
  });
});
