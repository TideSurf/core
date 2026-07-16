import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import {
  accessSync,
  constants,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join, posix, win32 } from "node:path";
import type { Readable } from "node:stream";
import CDP from "chrome-remote-interface";
import { CHROME_CHANNELS, type ChromeChannel } from "../types.js";
import { CDPConnectionError, ChromeLaunchError } from "../errors.js";
import { validatePort } from "../validation.js";
import { withTimeout } from "./timeout.js";

const LOCAL_CDP_HOST = "127.0.0.1";

const EXECUTABLE_NAMES: Record<ChromeChannel, Record<string, readonly string[]>> = {
  stable: {
    darwin: ["google-chrome", "chrome"],
    linux: ["google-chrome", "google-chrome-stable"],
    win32: ["chrome.exe"],
  },
  beta: {
    darwin: ["google-chrome-beta"],
    linux: ["google-chrome-beta"],
    win32: [],
  },
  dev: {
    darwin: ["google-chrome-dev"],
    linux: ["google-chrome-unstable", "google-chrome-dev"],
    win32: [],
  },
  canary: {
    darwin: ["google-chrome-canary"],
    linux: ["google-chrome-canary"],
    win32: [],
  },
  chromium: {
    darwin: ["chromium"],
    linux: ["chromium", "chromium-browser"],
    win32: ["chromium.exe"],
  },
};

export interface ResolveChromeOptions {
  chromePath?: string;
  channel?: ChromeChannel;
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
}

export interface LaunchOptions {
  headless?: boolean;
  chromePath?: string;
  channel?: ChromeChannel;
  port?: number;
  userDataDir?: string;
  timeout?: number;
}

export interface LaunchResult {
  process: ChildProcess;
  port: number;
  host: string;
  targetId: string;
  userDataDir: string;
  ownsTempDir: boolean;
}

export interface DiscoverOptions {
  port?: number;
  host?: string;
  timeout?: number;
}

export interface DiscoverResult {
  port: number;
  host: string;
  targetId: string;
}

export interface DiscoverActiveOptions {
  channel?: ChromeChannel;
  userDataDir?: string;
  timeout?: number;
}

interface DevToolsActivePort {
  port: number;
  browserPath: string;
}

class DevToolsEndpointMismatchError extends ChromeLaunchError {}

const ownedBrowserEndpoints = new Set<string>();

/** True when TideSurf launched (and therefore owns) the browser at host:port. */
export function isOwnedBrowserEndpoint(host: string, port: number): boolean {
  return ownedBrowserEndpoints.has(`${host}:${port}`);
}

function selectedChannels(channel?: ChromeChannel): readonly ChromeChannel[] {
  return channel ? [channel] : CHROME_CHANNELS;
}

function joinForPlatform(platform: NodeJS.Platform, ...parts: string[]): string {
  return platform === "win32" ? win32.join(...parts) : posix.join(...parts);
}

function isExecutableFile(path: string, platform: NodeJS.Platform): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    if (platform === "win32") {
      if (!path.toLowerCase().endsWith(".exe")) return false;
    } else {
      accessSync(path, constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

function executableCandidates(
  channel: ChromeChannel,
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>
): string[] {
  const home = env["HOME"] || env["USERPROFILE"] || homedir();
  const localAppData = env["LOCALAPPDATA"];
  const programFiles = env["PROGRAMFILES"] || "C:\\Program Files";
  const programFilesX86 = env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";

  if (platform === "darwin") {
    const appNames: Record<ChromeChannel, string> = {
      stable: "Google Chrome.app/Contents/MacOS/Google Chrome",
      beta: "Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta",
      dev: "Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev",
      canary: "Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      chromium: "Chromium.app/Contents/MacOS/Chromium",
    };
    const suffix = appNames[channel];
    return [
      joinForPlatform(platform, home, "Applications", suffix),
      joinForPlatform(platform, "/Applications", suffix),
    ];
  }

  if (platform === "linux") {
    const names = EXECUTABLE_NAMES[channel].linux ?? [];
    const candidates = names.flatMap((name) => [
      joinForPlatform(platform, "/usr/bin", name),
      joinForPlatform(platform, "/usr/local/bin", name),
    ]);
    if (channel === "chromium") candidates.push("/snap/bin/chromium");
    return candidates;
  }

  if (platform === "win32") {
    const suffixes: Record<ChromeChannel, readonly string[]> = {
      stable: ["Google\\Chrome\\Application\\chrome.exe"],
      beta: ["Google\\Chrome Beta\\Application\\chrome.exe"],
      dev: ["Google\\Chrome Dev\\Application\\chrome.exe"],
      canary: ["Google\\Chrome SxS\\Application\\chrome.exe"],
      chromium: ["Chromium\\Application\\chrome.exe"],
    };
    const roots = [localAppData, programFiles, programFilesX86].filter(
      (root): root is string => Boolean(root)
    );
    return roots.flatMap((root) =>
      suffixes[channel].map((suffix) => joinForPlatform(platform, root, suffix))
    );
  }

  return [];
}

function pathCandidates(
  channel: ChromeChannel,
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>
): string[] {
  const value = env["PATH"];
  if (!value) return [];
  const separator = platform === "win32" ? ";" : ":";
  const names = EXECUTABLE_NAMES[channel][platform] ?? [];
  return value
    .split(separator)
    .filter(Boolean)
    .flatMap((directory) =>
      names.map((name) => joinForPlatform(platform, directory, name))
    );
}

/** Ordered PATH and platform-install candidates used by executable resolution. */
export function getChromeExecutableSearchPaths(
  options: Pick<ResolveChromeOptions, "channel" | "env" | "platform"> = {}
): string[] {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const channels = selectedChannels(options.channel);
  return [
    ...channels.flatMap((channel) => pathCandidates(channel, platform, env)),
    ...channels.flatMap((channel) => executableCandidates(channel, platform, env)),
  ];
}

/** Resolve Chrome without invoking a shell or accepting unrelated Chromium forks. */
export function resolveChromeExecutable(options: ResolveChromeOptions = {}): string {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;

  if (options.chromePath !== undefined) {
    if (isExecutableFile(options.chromePath, platform)) return options.chromePath;
    throw new ChromeLaunchError(
      `Chrome executable is missing, not a regular file, or not executable: ${options.chromePath}`
    );
  }

  const envPath = env["CHROME_PATH"];
  if (envPath !== undefined) {
    if (isExecutableFile(envPath, platform)) return envPath;
    throw new ChromeLaunchError(
      `CHROME_PATH is missing, not a regular file, or not executable: ${envPath}`
    );
  }

  const searched = getChromeExecutableSearchPaths(options);
  for (const candidate of searched) {
    if (isExecutableFile(candidate, platform)) return candidate;
  }

  const scope = options.channel ? `Chrome channel "${options.channel}"` : "Chrome or Chromium";
  throw new ChromeLaunchError(
    `${scope} was not found. Pass chromePath or set CHROME_PATH.` +
      (searched.length > 0 ? ` Searched ${searched.join(", ")}` : "")
  );
}

export function buildChromeArgs(
  options: { headless: boolean; port: number; userDataDir: string },
  env: Record<string, string | undefined> = process.env,
  uid: number | undefined = process.getuid?.()
): string[] {
  const args = [
    `--remote-debugging-port=${options.port}`,
    `--user-data-dir=${options.userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
  ];

  if (options.headless) args.push("--headless=new");

  const explicitNoSandbox = env["TIDESURF_NO_SANDBOX"] === "1";
  if (explicitNoSandbox || uid === 0) {
    if (explicitNoSandbox) {
      console.warn(
        "[SECURITY WARNING] TIDESURF_NO_SANDBOX disables Chrome sandbox isolation."
      );
    } else {
      console.warn(
        "[SECURITY WARNING] Chrome sandbox is disabled because TideSurf is running as root."
      );
    }
    args.push(
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage"
    );
  }

  return args;
}

export function parseDevToolsActivePort(contents: string): DevToolsActivePort {
  const [portLine, browserPath = ""] = contents.trim().split(/\r?\n/, 2);
  const port = Number(portLine);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new ChromeLaunchError("DevToolsActivePort contains an invalid port");
  }
  if (!browserPath.startsWith("/devtools/browser/")) {
    throw new ChromeLaunchError("DevToolsActivePort contains an invalid browser endpoint");
  }
  return { port, browserPath };
}

export function readDevToolsActivePort(userDataDir: string): DevToolsActivePort | null {
  try {
    return parseDevToolsActivePort(
      readFileSync(join(userDataDir, "DevToolsActivePort"), "utf8")
    );
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw error;
  }
}

function profileDirectories(
  channel: ChromeChannel,
  platform: NodeJS.Platform = process.platform,
  env: Record<string, string | undefined> = process.env
): string[] {
  const home = env["HOME"] || env["USERPROFILE"] || homedir();
  if (platform === "darwin") {
    const names: Record<ChromeChannel, string> = {
      stable: "Google/Chrome",
      beta: "Google/Chrome Beta",
      dev: "Google/Chrome Dev",
      canary: "Google/Chrome Canary",
      chromium: "Chromium",
    };
    return [
      joinForPlatform(
        platform,
        home,
        "Library",
        "Application Support",
        names[channel]
      ),
    ];
  }
  if (platform === "linux") {
    const names: Record<ChromeChannel, string> = {
      stable: "google-chrome",
      beta: "google-chrome-beta",
      dev: "google-chrome-unstable",
      canary: "google-chrome-canary",
      chromium: "chromium",
    };
    return [
      joinForPlatform(
        platform,
        env["XDG_CONFIG_HOME"] || joinForPlatform(platform, home, ".config"),
        names[channel]
      ),
    ];
  }
  if (platform === "win32" && env["LOCALAPPDATA"]) {
    const names: Record<ChromeChannel, string> = {
      stable: "Google\\Chrome\\User Data",
      beta: "Google\\Chrome Beta\\User Data",
      dev: "Google\\Chrome Dev\\User Data",
      canary: "Google\\Chrome SxS\\User Data",
      chromium: "Chromium\\User Data",
    };
    return [joinForPlatform(platform, env["LOCALAPPDATA"], names[channel])];
  }
  return [];
}

async function assertPortAvailable(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        reject(new ChromeLaunchError(`Port ${port} is already in use`));
      } else {
        reject(
          new ChromeLaunchError(`Cannot reserve port ${port}: ${error.message}`, {
            cause: error,
          })
        );
      }
    });
    server.listen({ host: LOCAL_CDP_HOST, port, exclusive: true }, () => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function processExited(proc: ChildProcess): boolean {
  return proc.exitCode !== null || proc.signalCode !== null;
}

function captureStartupStderr(stream: Readable | null): {
  read: () => string;
  stop: () => void;
} {
  const limit = 8_192;
  let tail = "";
  const onData = (chunk: Buffer | string) => {
    tail += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    if (tail.length > limit) tail = tail.slice(-limit);
  };
  stream?.on("data", onData);
  stream?.resume();
  return {
    read: () => tail.trim(),
    stop: () => stream?.removeListener("data", onData),
  };
}

function isConnectionRefused(error: unknown): boolean {
  if ((error as NodeJS.ErrnoException | undefined)?.code === "ECONNREFUSED") {
    return true;
  }
  return (
    error instanceof AggregateError &&
    error.errors.length > 0 &&
    error.errors.every(isConnectionRefused)
  );
}

function browserPathFromVersion(version: unknown): string {
  const webSocketUrl =
    version && typeof version === "object"
      ? (version as { webSocketDebuggerUrl?: unknown }).webSocketDebuggerUrl
      : undefined;
  if (typeof webSocketUrl !== "string") {
    throw new ChromeLaunchError(
      "Chrome /json/version response has no browser WebSocket endpoint"
    );
  }

  try {
    const endpoint = new URL(webSocketUrl);
    if (
      (endpoint.protocol !== "ws:" && endpoint.protocol !== "wss:") ||
      !endpoint.pathname.startsWith("/devtools/browser/")
    ) {
      throw new Error("invalid browser WebSocket endpoint");
    }
    return endpoint.pathname;
  } catch (error) {
    throw new ChromeLaunchError(
      "Chrome /json/version response has an invalid browser WebSocket endpoint",
      { cause: error instanceof Error ? error : undefined }
    );
  }
}

async function inspectMarkedEndpoint(
  active: DevToolsActivePort,
  timeout: number,
  operation: string
): Promise<Awaited<ReturnType<typeof CDP.List>>> {
  const [version, targets] = await withTimeout(
    Promise.all([
      CDP.Version({ port: active.port, host: LOCAL_CDP_HOST, useHostName: true }),
      CDP.List({ port: active.port, host: LOCAL_CDP_HOST, useHostName: true }),
    ]),
    timeout,
    operation
  );
  const actualPath = browserPathFromVersion(version);
  if (actualPath !== active.browserPath) {
    throw new DevToolsEndpointMismatchError(
      `DevToolsActivePort browser endpoint ${active.browserPath} does not match ${actualPath}`
    );
  }
  return targets;
}

function waitForProcessExit(proc: ChildProcess, timeout: number): Promise<boolean> {
  if (processExited(proc)) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      proc.removeListener("exit", onExit);
      resolve(value);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeout);
    proc.once("exit", onExit);
    if (processExited(proc)) finish(true);
  });
}

/** Stop an owned Chrome process and wait before its profile is removed. */
export async function terminateChromeProcess(
  proc: ChildProcess,
  gracefulTimeout = 5_000
): Promise<boolean> {
  if (processExited(proc)) return true;
  try {
    proc.kill("SIGTERM");
  } catch {
    return processExited(proc);
  }
  if (await waitForProcessExit(proc, gracefulTimeout)) return true;
  try {
    proc.kill("SIGKILL");
  } catch {
    return processExited(proc);
  }
  return waitForProcessExit(proc, gracefulTimeout);
}

async function waitForLaunchedBrowser(
  proc: ChildProcess,
  requestedPort: number,
  userDataDir: string,
  timeout: number,
  readStderr: () => string
): Promise<DiscoverResult> {
  const deadline = Date.now() + timeout;
  let lastError: unknown;
  let malformedMarkerSince: number | undefined;

  while (Date.now() < deadline) {
    if (processExited(proc)) {
      const stderr = readStderr();
      throw new ChromeLaunchError(
        `Chrome exited before DevTools was ready` +
          (proc.exitCode === null ? "" : ` (code ${proc.exitCode})`) +
          (stderr ? `\nChrome stderr:\n${stderr}` : "")
      );
    }

    let port = requestedPort;
    let active: DevToolsActivePort | null = null;
    if (port === 0) {
      try {
        active = readDevToolsActivePort(userDataDir);
        port = active?.port ?? 0;
        if (!active) malformedMarkerSince = undefined;
      } catch (error) {
        lastError = error;
        if (error instanceof ChromeLaunchError) {
          malformedMarkerSince ??= Date.now();
          if (Date.now() - malformedMarkerSince >= 250) throw error;
        }
      }
    }

    if (port !== 0) {
      malformedMarkerSince = undefined;
      try {
        const probeTimeout = Math.min(500, Math.max(1, deadline - Date.now()));
        const targets = active
          ? await inspectMarkedEndpoint(active, probeTimeout, "Chrome readiness")
          : await withTimeout(
            CDP.List({ port, host: LOCAL_CDP_HOST, useHostName: true }),
            probeTimeout,
            "Chrome readiness"
          );
        const page = targets.find(
          (target) => target.type === "page"
        );
        if (page) return { port, host: LOCAL_CDP_HOST, targetId: page.id };
      } catch (error) {
        if (error instanceof DevToolsEndpointMismatchError) throw error;
        lastError = error;
      }
    }

    await delay(50);
  }

  const stderr = readStderr();
  throw new ChromeLaunchError(
    `Timed out waiting for Chrome DevTools` +
      (stderr ? `\nChrome stderr:\n${stderr}` : ""), {
    cause: lastError instanceof Error ? lastError : undefined,
  });
}

/** Launch one isolated Chrome process and return its real CDP endpoint. */
export async function launchChrome(options: LaunchOptions = {}): Promise<LaunchResult> {
  const chromePath = resolveChromeExecutable({
    chromePath: options.chromePath,
    channel: options.channel,
  });
  const requestedPort = options.port ?? 0;
  if (options.port !== undefined) {
    validatePort(options.port);
    await assertPortAvailable(options.port);
  }

  const ownsTempDir = options.userDataDir === undefined;
  const userDataDir = options.userDataDir ?? join(tmpdir(), `tidesurf-${randomUUID()}`);
  let proc: ChildProcess | undefined;
  try {
    mkdirSync(userDataDir, { recursive: true, mode: 0o700 });

    // A valid marker is removed only after its recorded browser is unreachable.
    const activePortFile = join(userDataDir, "DevToolsActivePort");
    const active = readDevToolsActivePort(userDataDir);
    if (active) {
      let reachable = false;
      let probeError: unknown;
      try {
        await inspectMarkedEndpoint(active, 250, "active Chrome profile");
        reachable = true;
      } catch (error) {
        probeError = error;
      }
      if (reachable) {
        throw new ChromeLaunchError(
          `The Chrome profile is already active: ${userDataDir}`
        );
      }
      if (
        !(probeError instanceof DevToolsEndpointMismatchError) &&
        !isConnectionRefused(probeError)
      ) {
        throw new ChromeLaunchError(
          `Could not verify whether the Chrome profile is active: ${userDataDir}`,
          { cause: probeError instanceof Error ? probeError : undefined }
        );
      }
      rmSync(activePortFile, { force: true });
    }

    const args = buildChromeArgs({
      headless: options.headless ?? true,
      port: requestedPort,
      userDataDir,
    });
    const launchedProcess = spawn(chromePath, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    proc = launchedProcess;
    launchedProcess.stdout?.resume();
    const stderr = captureStartupStderr(launchedProcess.stderr);

    let onSpawnError: ((error: Error) => void) | undefined;
    const spawnFailure = new Promise<never>((_resolve, reject) => {
      onSpawnError = (error: Error) =>
        reject(new ChromeLaunchError(`Chrome process error: ${error.message}`, { cause: error }));
      launchedProcess.once("error", onSpawnError);
    });
    const endpoint = await Promise.race([
      waitForLaunchedBrowser(
        launchedProcess,
        requestedPort,
        userDataDir,
        options.timeout ?? 15_000,
        stderr.read
      ),
      spawnFailure,
    ]).finally(() => {
      if (onSpawnError) launchedProcess.removeListener("error", onSpawnError);
      stderr.stop();
    });
    ownedBrowserEndpoints.add(`${endpoint.host}:${endpoint.port}`);
    return {
      process: launchedProcess,
      ...endpoint,
      userDataDir,
      ownsTempDir,
    };
  } catch (error) {
    const exited = proc ? await terminateChromeProcess(proc) : true;
    const launchError = error instanceof ChromeLaunchError
      ? error
      : new ChromeLaunchError(
        `Failed to launch Chrome: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error instanceof Error ? error : undefined }
      );
    if (!exited) {
      throw new ChromeLaunchError(
        `${launchError.message}; failed to stop the Chrome process`,
        { cause: launchError }
      );
    }
    if (ownsTempDir) {
      try {
        await rm(userDataDir, { recursive: true, force: true });
      } catch (cleanupError) {
        throw new ChromeLaunchError(
          `${launchError.message}; failed to remove temporary profile ${userDataDir}`,
          {
            cause: new AggregateError(
              [launchError, cleanupError],
              "Chrome launch and profile cleanup failed"
            ),
          }
        );
      }
    }
    throw launchError;
  }
}

/** Discover a fixed host/port endpoint without launching a browser. */
export async function discoverBrowser(
  options: DiscoverOptions = {}
): Promise<DiscoverResult> {
  const port = options.port ?? 9222;
  validatePort(port);
  const host = options.host ?? "localhost";
  const timeout = options.timeout ?? 10_000;

  try {
    const targets = await withTimeout(
      CDP.List({ port, host, useHostName: true }),
      timeout,
      "discoverBrowser"
    );
    const page = targets.find(
      (target) => target.type === "page"
    );
    if (!page) {
      throw new CDPConnectionError(
        `Chrome is available on ${host}:${port}, but it has no page target`
      );
    }
    return { port, host, targetId: page.id };
  } catch (error) {
    if (error instanceof CDPConnectionError) throw error;
    throw new CDPConnectionError(
      `No Chrome CDP endpoint is available on ${host}:${port}`,
      { cause: error instanceof Error ? error : undefined }
    );
  }
}

/** Discover Chrome 144+ remote debugging through a profile marker. */
export async function discoverActiveBrowser(
  options: DiscoverActiveOptions = {}
): Promise<DiscoverResult> {
  const profiles = options.userDataDir
    ? [options.userDataDir]
    : selectedChannels(options.channel).flatMap((channel) => profileDirectories(channel));
  let lastError: unknown;
  const deadline = Date.now() + (options.timeout ?? 5_000);

  for (const profile of profiles) {
    let active: DevToolsActivePort | null;
    try {
      active = readDevToolsActivePort(profile);
    } catch (error) {
      lastError = error;
      continue;
    }
    if (!active) continue;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    try {
      const targets = await inspectMarkedEndpoint(
        active,
        Math.min(1_000, remaining),
        "active Chrome profile discovery"
      );
      const page = targets.find((target) => target.type === "page");
      if (!page) {
        throw new CDPConnectionError(
          `Chrome is available on localhost:${active.port}, but it has no page target`
        );
      }
      return { port: active.port, host: LOCAL_CDP_HOST, targetId: page.id };
    } catch (error) {
      lastError = error;
    }
  }

  const location = options.userDataDir ?? options.channel ?? "known Chrome profiles";
  throw new CDPConnectionError(`No active remote-debugging profile found for ${location}`, {
    cause: lastError instanceof Error ? lastError : undefined,
  });
}
