import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import CDP from "chrome-remote-interface";
import { ChromeLaunchError, CDPConnectionError } from "../errors.js";

const CHROME_PATHS: Record<string, string[]> = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  ],
  linux: [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ],
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ],
};

function findChrome(customPath?: string): string {
  if (customPath) {
    if (existsSync(customPath)) return customPath;
    throw new ChromeLaunchError(`Chrome not found at specified path: ${customPath}`);
  }

  const envPath = process.env["CHROME_PATH"];
  if (envPath && existsSync(envPath)) return envPath;

  const platform = process.platform;
  const paths = CHROME_PATHS[platform] ?? [];
  for (const p of paths) {
    if (existsSync(p)) return p;
  }

  throw new ChromeLaunchError(
    `Chrome not found. Set CHROME_PATH env var or install Chrome. Searched: ${paths.join(", ")}`
  );
}

export interface LaunchOptions {
  headless?: boolean;
  chromePath?: string;
  port?: number;
  userDataDir?: string;
}

export interface LaunchResult {
  process: ChildProcess;
  port: number;
  wsUrl: string;
  userDataDir: string;
  ownsTempDir: boolean;
}

/**
 * Launch a Chrome process with remote debugging enabled
 */
export async function launchChrome(options: LaunchOptions = {}): Promise<LaunchResult> {
  const chromePath = findChrome(options.chromePath);
  const port = options.port ?? 9222;
  const ownsTempDir = !options.userDataDir;
  const userDataDir =
    options.userDataDir ?? join(tmpdir(), `tidesurf-${randomUUID()}`);
  const headless = options.headless ?? true;

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
  ];

  if (headless) {
    args.push("--headless=new");
  }

  // CI environments (GitHub Actions, Docker) often run as root
  if (process.env["CI"] || process.getuid?.() === 0) {
    args.push(
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
    );
  }

  let proc: ChildProcess;
  try {
    proc = spawn(chromePath, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    throw new ChromeLaunchError(
      `Failed to spawn Chrome: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err instanceof Error ? err : undefined }
    );
  }

  const wsUrl = await waitForDevTools(proc);

  return {
    process: proc,
    port,
    wsUrl,
    userDataDir,
    ownsTempDir,
  };
}

export interface DiscoverOptions {
  port?: number;
  host?: string;
}

export interface DiscoverResult {
  port: number;
  host: string;
}

/**
 * Discover a running Chrome instance with remote debugging enabled.
 * Tries CDP.List on the given port (default 9222) to verify connectivity.
 *
 * If Chrome is running with --remote-debugging-port, or the user has enabled
 * remote debugging via chrome://inspect#remote-debugging (Chrome M144+),
 * this will find it.
 */
export async function discoverBrowser(
  options: DiscoverOptions = {}
): Promise<DiscoverResult> {
  const port = options.port ?? 9222;
  const host = options.host ?? "localhost";

  try {
    const targets = await CDP.List({ port, host });
    const pages = (targets as Array<{ type: string }>).filter(
      (t) => t.type === "page"
    );
    if (pages.length === 0) {
      throw new CDPConnectionError(
        `Found Chrome on ${host}:${port} but no open page targets. ` +
        `Open a tab in Chrome and try again.`
      );
    }
    return { port, host };
  } catch (err) {
    if (err instanceof CDPConnectionError) throw err;
    throw new CDPConnectionError(
      `No Chrome instance found on ${host}:${port}. ` +
      `Make sure Chrome is running with remote debugging enabled:\n` +
      `  1. Open chrome://inspect#remote-debugging and enable it (Chrome 144+), or\n` +
      `  2. Launch Chrome with: --remote-debugging-port=${port}`,
      { cause: err instanceof Error ? err : undefined }
    );
  }
}

function waitForDevTools(proc: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    const stderr = proc.stderr;
    if (!stderr) {
      reject(new ChromeLaunchError("No stderr stream from Chrome process"));
      return;
    }

    // Capture in a const so TypeScript knows it's non-null inside closures
    const stderrStream = stderr;
    let accumulated = "";
    let settled = false;
    const timeoutMs = 15_000;

    function cleanup() {
      clearTimeout(timer);
      stderrStream.removeAllListeners("data");
      proc.removeListener("error", onError);
      proc.removeListener("exit", onExit);
    }

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new ChromeLaunchError("Timed out waiting for Chrome DevTools"));
    }, timeoutMs);

    const onError = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new ChromeLaunchError(`Chrome process error: ${err.message}`, { cause: err }));
    };

    const onExit = (code: number | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new ChromeLaunchError(`Chrome exited with code ${code} before DevTools was ready`));
    };

    stderrStream.setEncoding("utf-8");
    stderrStream.on("data", (chunk: string) => {
      accumulated += chunk;
      const match = accumulated.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(match[1]);
      }
    });

    proc.on("error", onError);
    proc.on("exit", onExit);
  });
}
