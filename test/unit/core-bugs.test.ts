import { describe, it, expect, jest } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SurfingPage } from "../../src/cdp/page.js";
import { TideSurf } from "../../src/tidesurf.js";
import {
  ElementNotFoundError,
  ReadOnlyError,
  ValidationError,
} from "../../src/errors.js";
import type { CDPConnection } from "../../src/cdp/connection.js";

function createMockCDPConnection(overrides: Partial<CDPConnection> = {}): CDPConnection {
  return {
    client: { close: jest.fn() } as unknown as CDPConnection["client"],
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
      loadEventFired: jest.fn(),
      captureScreenshot: jest.fn().mockResolvedValue({ data: "base64png" }),
    } as unknown as CDPConnection["Page"],
    Runtime: {
      enable: jest.fn(),
      evaluate: jest.fn().mockResolvedValue({ result: { value: "test" } }),
      callFunctionOn: jest.fn().mockResolvedValue({}),
      releaseObject: jest.fn(),
    } as unknown as CDPConnection["Runtime"],
    Input: {
      dispatchKeyEvent: jest.fn(),
    } as unknown as CDPConnection["Input"],
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
    const runtimeEvaluate = jest.fn(
      async ({ expression }: { expression: string }) => ({
        result: {
          value: expression.includes("const page =")
            ? {
                url: "https://example.com/",
                title: "Example",
                scrollY: 0,
                scrollHeight: 100,
                viewportHeight: 100,
                elementCount: 4,
              }
            : undefined,
        },
      })
    );
    const textNode = {
      nodeId: 5,
      backendNodeId: 5,
      nodeType: 3,
      nodeName: "#text",
      localName: "",
      nodeValue: `${expected}tail`,
    };
    const element = (
      nodeId: number,
      nodeName: string,
      children: unknown[]
    ) => ({
      nodeId,
      backendNodeId: nodeId,
      nodeType: 1,
      nodeName,
      localName: nodeName.toLowerCase(),
      nodeValue: "",
      children,
      attributes: [],
    });
    const root = {
      nodeId: 1,
      backendNodeId: 1,
      nodeType: 9,
      nodeName: "#document",
      localName: "",
      nodeValue: "",
      children: [
        element(2, "HTML", [
          element(3, "BODY", [element(4, "P", [textNode])]),
        ]),
      ],
    };
    const page = new SurfingPage(
      createMockCDPConnection({
        DOM: {
          getDocument: jest.fn().mockResolvedValue({ root }),
        } as unknown as CDPConnection["DOM"],
        Runtime: {
          evaluate: runtimeEvaluate,
        } as unknown as CDPConnection["Runtime"],
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

  it("serializes marker-bearing inspections without blocking actions", async () => {
    let releaseFirstInspection!: () => void;
    const firstInspectionGate = new Promise<void>((resolve) => {
      releaseFirstInspection = resolve;
    });
    let inspectionCalls = 0;
    const runtimeEvaluate = jest.fn(
      async ({ expression }: { expression: string }) => {
        if (expression.includes("const page =")) {
          inspectionCalls++;
          if (inspectionCalls === 1) await firstInspectionGate;
          return {
            result: {
              value: {
                url: "https://example.com/",
                title: "Example",
                scrollY: 0,
                scrollHeight: 100,
                viewportHeight: 100,
                elementCount: 0,
              },
            },
          };
        }
        return { result: { value: undefined } };
      }
    );
    const conn = createMockCDPConnection({
      DOM: {
        getDocument: jest.fn().mockResolvedValue({
          root: {
            nodeId: 1,
            backendNodeId: 1,
            nodeType: 9,
            nodeName: "#document",
            localName: "",
            nodeValue: "",
            children: [],
          },
        }),
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

    const state = page.getState({ includeHidden: true });
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
  it("preserves the CDP error when a mapped node no longer exists", async () => {
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

    await expect(page.click("B1")).rejects.toThrow("Node not found");
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
    await expect(TideSurf.connect({ timeout: 0 })).rejects.toBeInstanceOf(
      ValidationError
    );
    await expect(
      TideSurf.launch({ defaultViewport: { width: 1280, height: -1 } })
    ).rejects.toBeInstanceOf(ValidationError);

    const evaluate = jest.fn();
    const page = new SurfingPage(
      createMockCDPConnection({
        Runtime: { evaluate } as unknown as CDPConnection["Runtime"],
      })
    );
    await expect(page.waitForStable(0)).rejects.toBeInstanceOf(ValidationError);
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
});
