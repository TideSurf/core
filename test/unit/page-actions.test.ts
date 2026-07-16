import { afterAll, describe, expect, it, mock } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SurfingPage } from "../../src/cdp/page.js";
import type { CDPConnection } from "../../src/cdp/connection.js";
import { ActionCommittedError, CDPTimeoutError } from "../../src/errors.js";

function mockConn(onEvaluate?: (expression: string) => void) {
  const expressions: string[] = [];
  const handlers = new Map<string, (params: never) => void>();
  const conn = {
    client: Object.assign(new EventEmitter(), {
      close: mock(() => {}),
      send: mock(async () => ({})),
    }),
    DOM: {
      resolveNode: mock(async () => ({ object: { objectId: "obj-1" } })),
    },
    Page: {
      setDownloadBehavior: mock(async () => {}),
      on: mock((event: string, handler: (params: never) => void) => {
        handlers.set(event, handler);
        return () => handlers.delete(event);
      }),
    },
    Runtime: {
      evaluate: mock(async ({ expression }: { expression: string }) => {
        expressions.push(expression);
        onEvaluate?.(expression);
        return { result: { value: true } };
      }),
      callFunctionOn: mock(async () => ({ result: { value: true } })),
      releaseObject: mock(async () => ({})),
    },
    Emulation: {},
  } as unknown as CDPConnection;
  return { conn, expressions, handlers };
}

function setNodeMap(page: SurfingPage, entries: Array<[string, number]>): void {
  (page as unknown as { lastNodeMap: Map<string, number> }).lastNodeMap =
    new Map(entries);
}

const fileRoot = mkdtempSync(join(tmpdir(), "tidesurf-page-actions-"));
afterAll(() => rmSync(fileRoot, { recursive: true, force: true }));

describe("scroll settling", () => {
  it("waits for the page to settle after scrolling", async () => {
    const { conn, expressions } = mockConn();
    const page = new SurfingPage(conn);

    await page.scroll("down", 250);

    const scrollIndex = expressions.findIndex((e) => e.includes("scrollBy"));
    const settleIndex = expressions.findIndex((e) =>
      e.includes("MutationObserver")
    );
    expect(scrollIndex).toBeGreaterThanOrEqual(0);
    expect(settleIndex).toBeGreaterThan(scrollIndex);
  });

  it("reports a failed post-scroll settle as committed", async () => {
    const settleError = new Error("settle failed");
    const { conn } = mockConn((expression) => {
      if (expression.includes("MutationObserver")) throw settleError;
    });
    const page = new SurfingPage(conn);

    const scroll = page.scroll("down");
    await expect(scroll).rejects.toBeInstanceOf(ActionCommittedError);
    await expect(scroll).rejects.toHaveProperty("cause", settleError);
  });
});

describe("download timeout budget", () => {
  it("is not bounded by the instance CDP operation timeout", async () => {
    const { conn, handlers } = mockConn();
    const page = new SurfingPage(conn, [fileRoot], {}, false, 80);
    setNodeMap(page, [["B1", 42]]);

    const started = Date.now();
    const pending = page.download("B1", {
      downloadDir: join(fileRoot, "downloads"),
    });
    setTimeout(() => {
      handlers.get("downloadWillBegin")?.({
        guid: "slow",
        suggestedFilename: "slow.bin",
      } as never);
      handlers.get("downloadProgress")?.({
        guid: "slow",
        state: "completed",
        totalBytes: 5,
      } as never);
    }, 200);

    await expect(pending).resolves.toMatchObject({
      fileName: "slow.bin",
      totalBytes: 5,
    });
    expect(Date.now() - started).toBeGreaterThanOrEqual(150);
  });

  it("honors an explicit per-call timeout", async () => {
    const { conn } = mockConn();
    const page = new SurfingPage(conn, [fileRoot]);
    setNodeMap(page, [["B1", 42]]);

    const pending = page.download("B1", {
      downloadDir: join(fileRoot, "downloads"),
      timeout: 30,
    });
    await expect(pending).rejects.toBeInstanceOf(ActionCommittedError);
    await expect(pending).rejects.toHaveProperty(
      "cause",
      expect.any(CDPTimeoutError)
    );
  });
});
