import { describe, expect, it, mock } from "bun:test";
import { downloadFromAction } from "../../src/cdp/download-manager.js";
import type { CDPConnection } from "../../src/cdp/connection.js";

function harness(restoreError?: Error) {
  const handlers = new Map<string, (params: never) => void>();
  const events: string[] = [];
  const conn = {
    client: { send: mock(async () => ({})) },
    Page: {
      setDownloadBehavior: mock(async ({ behavior }: { behavior: string }) => {
        if (behavior === "default" && restoreError) throw restoreError;
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

  it("reports a download-policy restore failure after completion", async () => {
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
        } as never);
      }
    );

    await expect(download).rejects.toBe(restoreError);
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
