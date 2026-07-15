import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { DownloadResult } from "../types.js";
import { ValidationError } from "../errors.js";
import type { CDPConnection } from "./connection.js";
import { withTimeout } from "./timeout.js";

const activeDownloads = new WeakSet<object>();

interface DownloadProgress {
  state: string;
  totalBytes?: number;
}

/** Reserve the page, configure downloads, trigger one action, and clean up. */
export async function downloadFromAction(
  conn: CDPConnection,
  options: {
    downloadDir?: string;
    temporaryRoot?: string;
    timeout?: number;
    expectedUrl?: string;
  },
  trigger: () => Promise<void>
): Promise<DownloadResult> {
  if (activeDownloads.has(conn)) {
    throw new ValidationError("A download is already active on this page");
  }
  activeDownloads.add(conn);

  const ownsDirectory = options.downloadDir === undefined;
  const downloadDir = options.downloadDir ?? join(
    options.temporaryRoot ?? tmpdir(),
    `tidesurf-dl-${randomUUID()}`
  );
  let unsubscribeBegin: (() => void) | undefined;
  let unsubscribeProgress: (() => void) | undefined;
  let completed = false;
  let guid: string | undefined;
  let fileName: string | undefined;
  let downloadBehaviorMayBeConfigured = false;

  const cleanup = async () => {
    const failures: unknown[] = [];
    const attempt = async (operation: () => unknown | Promise<unknown>) => {
      try {
        await operation();
      } catch (error) {
        failures.push(error);
      }
    };

    await attempt(() => unsubscribeBegin?.());
    await attempt(() => unsubscribeProgress?.());
    if (!completed && guid) {
      await attempt(() =>
        withTimeout(
          conn.client.send("Browser.cancelDownload", { guid }),
          2_000,
          "download:cancel"
        )
      );
    }
    if (downloadBehaviorMayBeConfigured) {
      await attempt(() =>
        withTimeout(
          conn.Page.setDownloadBehavior({ behavior: "default" }),
          2_000,
          "download:restore"
        )
      );
    }
    activeDownloads.delete(conn);
    if (ownsDirectory && !completed) {
      await attempt(() => rmSync(downloadDir, { recursive: true, force: true }));
    }
    if (failures.length > 0) throw failures[0];
  };

  let operationFailed = false;
  try {
    mkdirSync(downloadDir, { recursive: true, mode: 0o700 });
    downloadBehaviorMayBeConfigured = true;
    await withTimeout(
      conn.Page.setDownloadBehavior({ behavior: "allow", downloadPath: downloadDir }),
      5_000,
      "download:configure"
    );

    let settled = false;
    const pendingProgress = new Map<string, DownloadProgress>();
    let resolveDownload!: (result: DownloadResult) => void;
    let rejectDownload!: (error: Error) => void;
    const download = new Promise<DownloadResult>((resolve, reject) => {
      resolveDownload = resolve;
      rejectDownload = reject;
    });
    // The trigger can fail before the event promise is awaited.
    void download.catch(() => undefined);

    const finish = (progress: DownloadProgress) => {
      if (settled || !guid || !fileName) return;
      if (progress.state === "completed") {
        settled = true;
        resolveDownload({
          filePath: join(downloadDir, fileName),
          fileName,
          totalBytes: progress.totalBytes ?? 0,
        });
      } else if (progress.state === "canceled") {
        settled = true;
        rejectDownload(new Error("Download canceled"));
      }
    };

    unsubscribeBegin = conn.Page.on(
      "downloadWillBegin",
      (params: { guid: string; suggestedFilename: string; url?: string }) => {
        if (settled || guid || (options.expectedUrl && params.url !== options.expectedUrl)) {
          return;
        }
        guid = params.guid;
        fileName = basename(params.suggestedFilename);
        const buffered = pendingProgress.get(params.guid);
        if (buffered) finish(buffered);
      }
    );
    unsubscribeProgress = conn.Page.on(
      "downloadProgress",
      (params: { guid: string; state: string; totalBytes?: number }) => {
        if (settled) return;
        const progress = { state: params.state, totalBytes: params.totalBytes };
        if (!guid) {
          pendingProgress.set(params.guid, progress);
          if (pendingProgress.size > 256) {
            pendingProgress.delete(pendingProgress.keys().next().value!);
          }
        } else if (params.guid === guid) {
          finish(progress);
        }
      }
    );

    await trigger();
    const result = await withTimeout(
      download,
      options.timeout ?? 30_000,
      "download"
    );
    completed = true;
    return result;
  } catch (error) {
    operationFailed = true;
    throw error;
  } finally {
    try {
      await cleanup();
    } catch (error) {
      if (!operationFailed) throw error;
    }
  }
}
