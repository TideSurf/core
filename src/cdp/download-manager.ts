import type { CDPConnection } from "./connection.js";
import type { DownloadResult } from "../types.js";
import { withTimeout } from "./timeout.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Configure Chrome to allow downloads to a specific directory.
 * @returns The resolved download directory path
 */
export async function setupDownloads(
  conn: CDPConnection,
  downloadDir?: string
): Promise<string> {
  const dir = downloadDir ?? join(tmpdir(), `tidesurf-dl-${randomUUID()}`);

  await conn.Page.setDownloadBehavior({
    behavior: "allow",
    downloadPath: dir,
  });

  return dir;
}

/**
 * Wait for a download to complete.
 * Listens for Page.downloadWillBegin and Page.downloadProgress events.
 * @returns DownloadResult with file path, name, and size
 */
export async function downloadFile(
  conn: CDPConnection,
  downloadDir: string,
  timeout: number = 30000
): Promise<DownloadResult> {
  return withTimeout(
    new Promise<DownloadResult>((resolve, reject) => {
      let fileName = "";
      let guid = "";

      const onBegin = (params: { guid: string; suggestedFilename: string }) => {
        guid = params.guid;
        fileName = params.suggestedFilename;
      };

      const onProgress = (params: {
        guid: string;
        state: string;
        totalBytes?: number;
      }) => {
        if (params.guid === guid && params.state === "completed") {
          conn.Page.removeListener("downloadWillBegin", onBegin);
          conn.Page.removeListener("downloadProgress", onProgress);
          resolve({
            filePath: join(downloadDir, fileName),
            fileName,
            totalBytes: params.totalBytes ?? 0,
          });
        } else if (params.guid === guid && params.state === "canceled") {
          conn.Page.removeListener("downloadWillBegin", onBegin);
          conn.Page.removeListener("downloadProgress", onProgress);
          reject(new Error("Download canceled"));
        }
      };

      conn.Page.on("downloadWillBegin", onBegin);
      conn.Page.on("downloadProgress", onProgress);
    }),
    timeout,
    "download"
  );
}
