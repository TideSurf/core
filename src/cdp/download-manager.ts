import type { CDPConnection } from "./connection.js";
import type { DownloadResult } from "../types.js";
import { withTimeout } from "./timeout.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";

/**
 * Configure Chrome to allow downloads to a specific directory.
 * Creates the directory if it doesn't exist.
 * @returns The resolved download directory path
 */
export async function setupDownloads(
  conn: CDPConnection,
  downloadDir?: string
): Promise<string> {
  const dir = downloadDir ?? join(tmpdir(), `tidesurf-dl-${randomUUID()}`);

  mkdirSync(dir, { recursive: true });

  await conn.Page.setDownloadBehavior({
    behavior: "allow",
    downloadPath: dir,
  });

  return dir;
}

/**
 * Wait for a download to complete.
 * Listens for Page.downloadWillBegin and Page.downloadProgress events.
 * Cleans up listeners on completion, cancellation, or timeout.
 * @returns DownloadResult with file path, name, and size
 */
export async function downloadFile(
  conn: CDPConnection,
  downloadDir: string,
  timeout: number = 30000
): Promise<DownloadResult> {
  let onBegin: ((params: { guid: string; suggestedFilename: string }) => void) | null = null;
  let onProgress: ((params: { guid: string; state: string; totalBytes?: number }) => void) | null = null;
  let unsubscribeBegin: (() => void) | null = null;
  let unsubscribeProgress: (() => void) | null = null;

  function cleanup() {
    unsubscribeBegin?.();
    unsubscribeProgress?.();
    onBegin = null;
    onProgress = null;
    unsubscribeBegin = null;
    unsubscribeProgress = null;
  }

  const downloadPromise = new Promise<DownloadResult>((resolve, reject) => {
    let fileName = "";
    let guid = "";

    onBegin = (params) => {
      guid = params.guid;
      fileName = params.suggestedFilename;
    };

    onProgress = (params) => {
      if (params.guid !== guid) return;
      if (params.state === "completed") {
        cleanup();
        resolve({
          filePath: join(downloadDir, fileName),
          fileName,
          totalBytes: params.totalBytes ?? 0,
        });
      } else if (params.state === "canceled") {
        cleanup();
        reject(new Error("Download canceled"));
      }
    };

    unsubscribeBegin = conn.Page.on("downloadWillBegin", onBegin);
    unsubscribeProgress = conn.Page.on("downloadProgress", onProgress);
  });

  try {
    return await withTimeout(downloadPromise, timeout, "download");
  } catch (err) {
    cleanup();
    throw err;
  }
}
