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
 * Download state tracker for managing download event handlers.
 * Enhanced to track by URL and handle GUID assignment race (NEW-CDP-001).
 */
interface DownloadState {
  fileName: string;
  guid: string;
  url: string;
  completed: boolean;
  canceled: boolean;
  resolve: (result: DownloadResult) => void;
  reject: (err: Error) => void;
}

/**
 * Setup download listeners BEFORE triggering the download.
 * This prevents race conditions where fast downloads complete before listeners are attached.
 * Tracks by URL for better multi-download handling and handles GUID assignment race.
 * @returns Object containing the download promise and cleanup function
 */
export function setupDownloadListeners(
  conn: CDPConnection,
  downloadDir: string,
  expectedUrl?: string
): {
  promise: Promise<DownloadResult>;
  cleanup: () => void;
} {
  const state: DownloadState = {
    fileName: "",
    guid: "",
    url: "",
    completed: false,
    canceled: false,
    resolve: () => {},
    reject: () => {},
  };

  let unsubscribeBegin: (() => void) | null = null;
  let unsubscribeProgress: (() => void) | null = null;

  const cleanup = () => {
    unsubscribeBegin?.();
    unsubscribeProgress?.();
    unsubscribeBegin = null;
    unsubscribeProgress = null;
  };

  const promise = new Promise<DownloadResult>((resolve, reject) => {
    state.resolve = resolve;
    state.reject = reject;

    const onBegin = (params: { guid: string; suggestedFilename: string; url?: string }) => {
      // If expectedUrl is provided, only track matching downloads
      if (expectedUrl && params.url && params.url !== expectedUrl) return;
      
      state.guid = params.guid;
      state.fileName = params.suggestedFilename;
      state.url = params.url || "";
    };

    const onProgress = (params: { guid: string; state: string; totalBytes?: number }) => {
      if (params.guid !== state.guid && state.guid !== "") return;
      
      // Handle GUID assignment race: if we haven't seen the begin event yet,
      // this might be a fast download. Store the guid if this is our first event.
      if (state.guid === "" && params.state === "completed") {
        state.guid = params.guid;
      }
      if (params.guid !== state.guid) return;

      if (params.state === "completed" && !state.completed) {
        state.completed = true;
        cleanup();
        resolve({
          filePath: join(downloadDir, state.fileName || "unknown"),
          fileName: state.fileName || "unknown",
          totalBytes: params.totalBytes ?? 0,
        });
      } else if (params.state === "canceled" && !state.canceled) {
        state.canceled = true;
        cleanup();
        reject(new Error("Download canceled"));
      }
    };

    unsubscribeBegin = conn.Page.on("downloadWillBegin", onBegin);
    unsubscribeProgress = conn.Page.on("downloadProgress", onProgress);
  });

  return { promise, cleanup };
}

/**
 * Wait for a download to complete.
 * Listens for Page.downloadWillBegin and Page.downloadProgress events.
 * Cleans up listeners on completion, cancellation, or timeout.
 * @returns DownloadResult with file path, name, and size
 * @deprecated Use setupDownloadListeners + waitForDownload instead to avoid race conditions
 */
export async function downloadFile(
  conn: CDPConnection,
  downloadDir: string,
  timeout: number = 30000
): Promise<DownloadResult> {
  const { promise, cleanup } = setupDownloadListeners(conn, downloadDir);

  try {
    return await withTimeout(promise, timeout, "download");
  } catch (err) {
    cleanup();
    throw err;
  }
}

/**
 * Wait for an existing download promise with timeout.
 * Use this after setupDownloadListeners and triggering the download action.
 */
export async function waitForDownload(
  downloadPromise: Promise<DownloadResult>,
  timeout: number,
  cleanup: () => void
): Promise<DownloadResult> {
  try {
    return await withTimeout(downloadPromise, timeout, "download");
  } catch (err) {
    cleanup();
    throw err;
  }
}
