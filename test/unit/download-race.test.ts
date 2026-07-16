import { describe, expect, it, mock } from "bun:test";
import { EventEmitter } from "node:events";
import { downloadFromAction } from "../../src/cdp/download-manager.js";
import type { CDPConnection } from "../../src/cdp/connection.js";
import { ActionCommittedError, CDPTimeoutError } from "../../src/errors.js";

function harness(
  restoreError?: Error,
  allow?: Promise<void>,
  restore?: Promise<void>
) {
  const handlers = new Map<string, (params: never) => void>();
  const events: string[] = [];
  const conn = {
    client: Object.assign(new EventEmitter(), {
      send: mock(async () => ({})),
    }),
    Page: {
      setDownloadBehavior: mock(async ({ behavior }: { behavior: string }) => {
        if (behavior === "allow" && allow) return allow;
        if (behavior === "default" && restoreError) throw restoreError;
        if (behavior === "default" && restore) return restore;
      }),
      on: mock((event: string, handler: (params: never) => void) => {
        events.push(`subscribe:${event}`);
        handlers.set(event, handler);
        return () => {
          events.push(`unsubscribe:${event}`);
          handlers.delete(event);
        };
      }),
    },
  } as unknown as CDPConnection;
  return { conn, handlers, events };
}

describe("download event races", () => {
  it("subscribes before a trigger can complete synchronously", async () => {
    const { conn, handlers, events } = harness();
    const download = downloadFromAction(
      conn,
      { downloadDir: "/tmp/downloads", timeout: 100 },
      async () => {
        events.push("trigger");
        handlers.get("downloadWillBegin")?.({
          guid: "instant",
          suggestedFilename: "instant.txt",
        } as never);
        handlers.get("downloadProgress")?.({
          guid: "instant",
          state: "completed",
          totalBytes: 9,
        } as never);
      }
    );

    await expect(download).resolves.toEqual({
      filePath: "/tmp/downloads/instant.txt",
      fileName: "instant.txt",
      totalBytes: 9,
    });
    expect(events.indexOf("subscribe:downloadProgress")).toBeLessThan(
      events.indexOf("trigger")
    );
  });

  it("ignores an unrelated begin event when an expected URL is set", async () => {
    const { conn, handlers } = harness();
    const download = downloadFromAction(
      conn,
      {
        downloadDir: "/tmp/downloads",
        timeout: 100,
        expectedUrl: "https://example.com/wanted",
      },
      async () => {
        handlers.get("downloadWillBegin")?.({
          guid: "other",
          suggestedFilename: "other.txt",
          url: "https://example.com/other",
        } as never);
        handlers.get("downloadProgress")?.({
          guid: "other",
          state: "completed",
        } as never);
        handlers.get("downloadWillBegin")?.({
          guid: "wanted",
          suggestedFilename: "wanted.txt",
          url: "https://example.com/wanted",
        } as never);
        handlers.get("downloadProgress")?.({
          guid: "wanted",
          state: "completed",
          totalBytes: 20,
        } as never);
      }
    );

    await expect(download).resolves.toMatchObject({
      fileName: "wanted.txt",
      totalBytes: 20,
    });
  });

  it("reports cancellation even when progress arrives before begin", async () => {
    const { conn, handlers } = harness();
    const download = downloadFromAction(
      conn,
      { downloadDir: "/tmp/downloads", timeout: 100 },
      async () => {
        handlers.get("downloadProgress")?.({
          guid: "canceled",
          state: "canceled",
        } as never);
        handlers.get("downloadWillBegin")?.({
          guid: "canceled",
          suggestedFilename: "never.txt",
        } as never);
      }
    );

    await expect(download).rejects.toThrow("Download canceled");
  });

  it("returns the completed download despite a policy restore failure", async () => {
    const restoreError = new Error("restore failed");
    const { conn, handlers } = harness(restoreError);
    const download = downloadFromAction(
      conn,
      { downloadDir: "/tmp/downloads", timeout: 100 },
      async () => {
        handlers.get("downloadWillBegin")?.({
          guid: "complete",
          suggestedFilename: "complete.txt",
        } as never);
        handlers.get("downloadProgress")?.({
          guid: "complete",
          state: "completed",
          totalBytes: 12,
        } as never);
      }
    );

    await expect(download).resolves.toEqual({
      filePath: "/tmp/downloads/complete.txt",
      fileName: "complete.txt",
      totalBytes: 12,
    });
    const setBehavior = conn.Page.setDownloadBehavior as unknown as {
      mock: { calls: Array<[{ behavior: string }]> };
    };
    expect(
      setBehavior.mock.calls.some(([params]) => params.behavior === "default")
    ).toBe(true);
  });

  it("still rejects an uncompleted download when restore also fails", async () => {
    const { conn } = harness(new Error("restore failed"));

    const attempt = downloadFromAction(
      conn,
      { downloadDir: "/tmp/downloads", timeout: 20 },
      async () => {}
    );

    await expect(attempt).rejects.toBeInstanceOf(ActionCommittedError);
    await expect(attempt).rejects.toHaveProperty(
      "cause",
      expect.any(CDPTimeoutError)
    );
  });

  it("restores behavior after a timed-out configure resolves late", async () => {
    let resolveAllow!: () => void;
    const allow = new Promise<void>((resolve) => {
      resolveAllow = resolve;
    });
    const { conn, handlers } = harness(undefined, allow);

    await expect(
      downloadFromAction(
        conn,
        { downloadDir: "/tmp/downloads", timeout: 5 },
        async () => {}
      )
    ).rejects.toBeInstanceOf(CDPTimeoutError);
    await expect(
      downloadFromAction(
        conn,
        { downloadDir: "/tmp/downloads", timeout: 100 },
        async () => {}
      )
    ).rejects.toThrow("already active");

    resolveAllow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const retry = downloadFromAction(
      conn,
      { downloadDir: "/tmp/downloads", timeout: 100 },
      async () => {
        handlers.get("downloadWillBegin")?.({
          guid: "retry",
          suggestedFilename: "retry.txt",
        } as never);
        handlers.get("downloadProgress")?.({
          guid: "retry",
          state: "completed",
        } as never);
      }
    );

    await expect(retry).resolves.toMatchObject({ fileName: "retry.txt" });
  });

  it("keeps the page reserved until a timed-out restore settles", async () => {
    let resolveRestore!: () => void;
    const restore = new Promise<void>((resolve) => {
      resolveRestore = resolve;
    });
    const { conn, handlers } = harness(undefined, undefined, restore);
    const first = downloadFromAction(
      conn,
      { downloadDir: "/tmp/downloads", timeout: 5 },
      async () => {
        handlers.get("downloadWillBegin")?.({
          guid: "first",
          suggestedFilename: "first.txt",
        } as never);
        handlers.get("downloadProgress")?.({
          guid: "first",
          state: "completed",
        } as never);
      }
    );

    await expect(first).resolves.toMatchObject({ fileName: "first.txt" });
    await expect(
      downloadFromAction(
        conn,
        { downloadDir: "/tmp/downloads", timeout: 100 },
        async () => {}
      )
    ).rejects.toThrow("already active");

    resolveRestore();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const retry = downloadFromAction(
      conn,
      { downloadDir: "/tmp/downloads", timeout: 100 },
      async () => {
        handlers.get("downloadWillBegin")?.({
          guid: "retry",
          suggestedFilename: "retry.txt",
        } as never);
        handlers.get("downloadProgress")?.({
          guid: "retry",
          state: "completed",
        } as never);
      }
    );

    await expect(retry).resolves.toMatchObject({ fileName: "retry.txt" });
  });

  it("keeps a trigger failure primary when policy restore also fails", async () => {
    const triggerError = new Error("trigger failed");
    const { conn } = harness(new Error("restore failed"));

    await expect(
      downloadFromAction(
        conn,
        { downloadDir: "/tmp/downloads", timeout: 100 },
        async () => {
          throw triggerError;
        }
      )
    ).rejects.toBe(triggerError);
  });
});
