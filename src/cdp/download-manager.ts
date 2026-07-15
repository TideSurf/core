import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { DownloadResult } from "../types.js";
import {
  ActionCommittedError,
  CDPConnectionError,
  CDPTimeoutError,
  ValidationError,
} from "../errors.js";
import {
  validateDownloadDirectory,
  validateFilePath,
} from "../validation.js";
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
    fileAccessRoots?: string[];
  },
  trigger: () => Promise<void>
): Promise<DownloadResult> {
  const ownsDirectory = options.downloadDir === undefined;
  let downloadDir = options.downloadDir;
  if (downloadDir !== undefined) {
    validateFilePath(downloadDir);
    if (options.fileAccessRoots !== undefined) {
      downloadDir = validateDownloadDirectory(
        downloadDir,
        options.fileAccessRoots
      );
    }
  }
  if (activeDownloads.has(conn)) {
    throw new ValidationError("A download is already active on this page");
  }
  activeDownloads.add(conn);

  let unsubscribeBegin: (() => void) | undefined;
  let unsubscribeProgress: (() => void) | undefined;
  let completed = false;
  let guid: string | undefined;
  let fileName: string | undefined;
  let configureBehavior: Promise<void> | undefined;
  let behaviorConfigured = false;
  let disconnected = false;
  let rejectDisconnect!: (error: Error) => void;
  const disconnectSignal = new Promise<never>((_resolve, reject) => {
    rejectDisconnect = reject;
  });
  void disconnectSignal.catch(() => undefined);
  const onDisconnect = () => {
    disconnected = true;
    rejectDisconnect(new CDPConnectionError("Chrome disconnected during download"));
  };
  conn.client.once("disconnect", onDisconnect);
  const untilDisconnect = <T>(operation: Promise<T>): Promise<T> =>
    Promise.race([operation, disconnectSignal]);

  const cleanup = async () => {
    const failures: unknown[] = [];
    let releaseDeferred = false;
    const attempt = async (operation: () => unknown | Promise<unknown>) => {
      try {
        await operation();
      } catch (error) {
        failures.push(error);
      }
    };

    conn.client.removeListener("disconnect", onDisconnect);
    await attempt(() => unsubscribeBegin?.());
    await attempt(() => unsubscribeProgress?.());
    if (!disconnected && !completed && guid) {
      await attempt(() =>
        withTimeout(
          conn.client.send("Browser.cancelDownload", { guid }),
          2_000,
          "download:cancel"
        )
      );
    }
    const deferReleaseUntil = (pending: Promise<unknown>) => {
      releaseDeferred = true;
      void pending.then(
        () => activeDownloads.delete(conn),
        () => activeDownloads.delete(conn)
      );
    };
    if (!disconnected && configureBehavior) {
      if (behaviorConfigured) {
        await attempt(async () => {
          const restore = conn.Page.setDownloadBehavior({ behavior: "default" });
          let restoreSettled = false;
          void restore.then(
            () => { restoreSettled = true; },
            () => { restoreSettled = true; }
          );
          try {
            await withTimeout(
              restore,
              Math.min(options.timeout ?? 2_000, 2_000),
              "download:restore"
            );
          } catch (error) {
            if (!restoreSettled) deferReleaseUntil(restore);
            throw error;
          }
        });
      } else {
        deferReleaseUntil(
          configureBehavior.then(() =>
            conn.Page.setDownloadBehavior({ behavior: "default" })
          )
        );
      }
    }
    if (!releaseDeferred) activeDownloads.delete(conn);
    const ownedDirectory = downloadDir;
    if (ownsDirectory && !completed && ownedDirectory) {
      await attempt(() => rm(ownedDirectory, { recursive: true, force: true }));
    }
    if (failures.length > 0) throw failures[0];
  };

  let operationFailed = false;
  let triggerStarted = false;
  let triggerCompleted = false;
  try {
    if (downloadDir === undefined) {
      const temporaryRoot = options.temporaryRoot ?? tmpdir();
      if (options.fileAccessRoots !== undefined) {
        validateDownloadDirectory(temporaryRoot, options.fileAccessRoots);
      }
      downloadDir = await mkdtemp(
        join(temporaryRoot, "tidesurf-dl-")
      );
    } else {
      await mkdir(downloadDir, { recursive: true, mode: 0o700 });
    }
    if (options.fileAccessRoots !== undefined) {
      downloadDir = validateDownloadDirectory(
        downloadDir,
        options.fileAccessRoots
      );
    }
    const activeDownloadDir = downloadDir;
    configureBehavior = conn.Page.setDownloadBehavior({
      behavior: "allow",
      downloadPath: activeDownloadDir,
    }).then(() => {
      behaviorConfigured = true;
    });
    await untilDisconnect(
      withTimeout(
        configureBehavior,
        Math.min(options.timeout ?? 5_000, 5_000),
        "download:configure"
      )
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
          filePath: join(activeDownloadDir, fileName),
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

    triggerStarted = true;
    await untilDisconnect(trigger());
    triggerCompleted = true;
    const result = await withTimeout(
      untilDisconnect(download),
      options.timeout ?? 30_000,
      "download"
    );
    completed = true;
    return result;
  } catch (error) {
    operationFailed = true;
    if (error instanceof ActionCommittedError) throw error;
    if (triggerCompleted) {
      throw new ActionCommittedError("Download trigger", error);
    }
    if (triggerStarted && (disconnected || error instanceof CDPTimeoutError)) {
      throw new ActionCommittedError("Download trigger", error, "uncertain");
    }
    throw error;
  } finally {
    try {
      await cleanup();
    } catch (error) {
      if (!operationFailed) {
        if (completed) throw new ActionCommittedError("Download", error);
        throw error;
      }
    }
  }
}
