import { randomUUID } from "node:crypto";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import {
  accessSync,
  constants,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
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
  ownershipToken: string;
  orphanToken: string;
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
  /** Browser websocket path from DevToolsActivePort, when known. */
  browserPath?: string;
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

/** Normalize loopback aliases so the same browser keys maps identically. */
export function normalizeEndpointHost(host: string): string {
  const trimmed = host.trim().toLowerCase();
  if (trimmed === "localhost" || trimmed === "::1" || trimmed === "[::1]") {
    return "127.0.0.1";
  }
  return trimmed;
}

function endpointKey(host: string, port: number): string {
  return `${normalizeEndpointHost(host)}:${port}`;
}

interface OwnedBrowserEndpointClaim {
  token: string;
  browserWsPath: string;
  verified: boolean;
}

const ownedBrowserEndpoints = new Map<string, OwnedBrowserEndpointClaim>();

function registerOwnedBrowserEndpoint(
  host: string,
  port: number,
  browserWsPath: string
): string {
  const token = randomUUID();
  ownedBrowserEndpoints.set(endpointKey(host, port), {
    token,
    browserWsPath,
    // The launch flow itself verified the browser's identity.
    verified: true,
  });
  return token;
}

/**
 * Forget only the exact endpoint generation represented by `ownershipToken`.
 * A late close from an older browser cannot release a replacement claim.
 */
export function releaseOwnedBrowserEndpoint(
  host: string,
  port: number,
  ownershipToken: string
): boolean {
  const key = endpointKey(host, port);
  if (ownedBrowserEndpoints.get(key)?.token !== ownershipToken) return false;
  ownedBrowserEndpoints.delete(key);
  return true;
}

/** Force ownership re-verification after a connection or rollback drops. */
export function noteOwnedBrowserDisconnected(
  host: string,
  port: number,
  ownershipToken?: string
): void {
  const claim = ownedBrowserEndpoints.get(endpointKey(host, port));
  if (!claim || (ownershipToken !== undefined && claim.token !== ownershipToken)) {
    return;
  }
  claim.verified = false;
}

/** True when TideSurf launched (and therefore owns) the browser at host:port. */
export function isOwnedBrowserEndpoint(host: string, port: number): boolean {
  return ownedBrowserEndpoints.has(endpointKey(host, port));
}

/**
 * Ownership check that re-verifies the browser's identity before trusting the
 * process-local registry. A port can be recycled by a foreign Chrome after the
 * owned browser died; without re-verification, TideSurf would treat that
 * foreign browser as owned and wipe its browser-wide permission overrides.
 */
export async function verifyOwnedBrowserEndpoint(
  host: string,
  port: number,
  timeoutMs = 1_000
): Promise<boolean> {
  const key = endpointKey(host, port);
  const claim = ownedBrowserEndpoints.get(key);
  if (!claim) return false;
  if (claim.verified) return true;
  const { token, browserWsPath: expectedPath } = claim;
  try {
    const version = await withTimeout(
      CDP.Version({ port, host: normalizeEndpointHost(host), useHostName: true }),
      Math.max(1, timeoutMs),
      "owned browser verification"
    );
    let actualPath: string | undefined;
    try {
      actualPath = browserPathFromVersion(version);
    } catch {
      actualPath = undefined;
    }
    const latest = ownedBrowserEndpoints.get(key);
    // Publication may have replaced this claim while CDP.Version was in
    // flight. Never apply the old generation's result to the replacement.
    if (latest?.token !== token) return false;
    if (actualPath !== undefined && actualPath === expectedPath) {
      latest.verified = true;
      return true;
    }
    // A foreign browser occupies the endpoint: drop only this stale claim.
    releaseOwnedBrowserEndpoint(host, port, token);
    return false;
  } catch {
    // The browser cannot be identified; do not claim ownership of it.
    return false;
  }
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

/** Chrome processes whose spawn failed ("error" fired before "exit"). */
const spawnFailedProcesses = new WeakSet<ChildProcess>();

function processExited(proc: ChildProcess): boolean {
  return (
    proc.exitCode !== null ||
    proc.signalCode !== null ||
    spawnFailedProcesses.has(proc)
  );
}

// --- Orphaned browser registry -----------------------------------------------
// Node's "exit" event never fires on SIGKILL/OOM-kill and there is no portable
// parent-death signal, so an owned Chrome can outlive its parent process.
// Launches are recorded in a shared tmpdir registry so that any later TideSurf
// process can reap browsers whose parent is gone (and their temp profiles).

interface OrphanRecord {
  chromePid: number;
  parentPid: number;
  userDataDir: string;
  ownsTempDir: boolean;
  createdAt: number;
  recordToken?: string;
  host?: string;
  port?: number;
  ownershipToken?: string;
  browserWsPath?: string;
}

const ORPHAN_REGISTRY_DIR = join(tmpdir(), "tidesurf-orphans");

function orphanRecordPath(parentPid: number, chromePid: number): string {
  return join(ORPHAN_REGISTRY_DIR, `${parentPid}-${chromePid}.json`);
}

function writeOrphanRecord(record: OrphanRecord): void {
  mkdirSync(ORPHAN_REGISTRY_DIR, { recursive: true, mode: 0o700 });
  const path = orphanRecordPath(record.parentPid, record.chromePid);
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(record)}\n`, { mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function registerOrphanedBrowser(
  record: Omit<OrphanRecord, "recordToken">
): string {
  const recordToken = randomUUID();
  try {
    writeOrphanRecord({ ...record, recordToken });
  } catch {
    // Bookkeeping is best-effort; never fail a launch over it.
  }
  return recordToken;
}

function updateOrphanedBrowserEndpoint(
  parentPid: number,
  chromePid: number,
  recordToken: string,
  endpoint: Pick<
    Required<OrphanRecord>,
    "host" | "port" | "ownershipToken" | "browserWsPath"
  >
): void {
  const path = orphanRecordPath(parentPid, chromePid);
  try {
    const current = JSON.parse(readFileSync(path, "utf8")) as OrphanRecord;
    if (current.recordToken !== recordToken) return;
    writeOrphanRecord({ ...current, ...endpoint });
  } catch {
    // Best-effort metadata enrichment; the base orphan record remains useful.
  }
}

/**
 * Remove the exact orphan generation after both process and profile cleanup.
 * Omitting `recordToken` is retained for explicit administrative/test cleanup.
 */
export function unregisterOrphanedBrowser(
  parentPid: number,
  chromePid: number,
  recordToken?: string
): boolean {
  const path = orphanRecordPath(parentPid, chromePid);
  try {
    if (recordToken !== undefined) {
      let current: OrphanRecord;
      try {
        current = JSON.parse(readFileSync(path, "utf8")) as OrphanRecord;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
        return false;
      }
      if (current.recordToken !== recordToken) return true;
    }
    rmSync(path, { force: true });
    return true;
  } catch {
    return false;
  }
}

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException | undefined)?.code === "EPERM";
  }
}

function parsePosixArguments(commandLine: string): string[] | undefined {
  const args: string[] = [];
  let value = "";
  let started = false;
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (const character of commandLine.trim()) {
    if (escaped) {
      value += character;
      started = true;
      escaped = false;
    } else if (character === "\\" && quote !== "'") {
      escaped = true;
      started = true;
    } else if (quote) {
      if (character === quote) quote = null;
      else value += character;
      started = true;
    } else if (character === "'" || character === '"') {
      quote = character;
      started = true;
    } else if (/\s/.test(character)) {
      if (started) {
        args.push(value);
        value = "";
        started = false;
      }
    } else {
      value += character;
      started = true;
    }
  }
  if (escaped) value += "\\";
  if (quote) return undefined;
  if (started) args.push(value);
  return args;
}

function parseWindowsArguments(commandLine: string): string[] | undefined {
  const args: string[] = [];
  let index = 0;
  while (index < commandLine.length) {
    while (/\s/.test(commandLine[index] ?? "")) index++;
    if (index >= commandLine.length) break;
    let value = "";
    let quoted = false;
    while (index < commandLine.length) {
      let backslashes = 0;
      while (commandLine[index] === "\\") {
        backslashes++;
        index++;
      }
      if (commandLine[index] === '"') {
        value += "\\".repeat(Math.floor(backslashes / 2));
        if (backslashes % 2 === 1) value += '"';
        else quoted = !quoted;
        index++;
        continue;
      }
      value += "\\".repeat(backslashes);
      const character = commandLine[index];
      if (character === undefined || (!quoted && /\s/.test(character))) break;
      value += character;
      index++;
    }
    if (quoted) return undefined;
    args.push(value);
    while (/\s/.test(commandLine[index] ?? "")) index++;
  }
  return args;
}

function execFileText(
  executable: string,
  args: string[],
  deadline: number
): Promise<string | undefined> {
  const timeout = deadline - Date.now();
  if (timeout <= 0) return Promise.resolve(undefined);
  return new Promise((resolveOutput) => {
    execFile(
      executable,
      args,
      {
        encoding: "utf8",
        windowsHide: true,
        timeout,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout) => resolveOutput(error ? undefined : stdout)
    );
  });
}

const PROCESS_IDENTITY_TIMEOUT_MS = 2_000;

export async function processArgumentsForCleanup(
  pid: number,
  platform: NodeJS.Platform = process.platform,
  deadline = Date.now() + PROCESS_IDENTITY_TIMEOUT_MS
): Promise<string[] | undefined> {
  if (platform === "linux") {
    try {
      const args = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0");
      if (args.at(-1) === "") args.pop();
      return args.length > 0 ? args : undefined;
    } catch {
      return undefined;
    }
  }
  if (platform === "win32") {
    const commandLine = await execFileText(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}' | Select-Object -ExpandProperty CommandLine)`,
      ],
      deadline
    );
    return commandLine === undefined
      ? undefined
      : parseWindowsArguments(commandLine.trim());
  }
  const commandLine = await execFileText(
    "ps",
    ["-ww", "-p", String(pid), "-o", "command="],
    deadline
  );
  return commandLine === undefined
    ? undefined
    : parsePosixArguments(commandLine);
}

function hasOwnedProfileArgument(args: readonly string[], userDataDir: string): boolean {
  const joined = `--user-data-dir=${userDataDir}`;
  return args.some((value, index) =>
    value === joined ||
    (value === "--user-data-dir" && args[index + 1] === userDataDir)
  );
}

function isOwnedTempProfileDir(userDataDir: string): boolean {
  return userDataDir.startsWith(join(tmpdir(), "tidesurf-"));
}

/**
 * Reap browsers recorded by now-dead TideSurf processes and remove their
 * temporary profiles. A recorded Chrome is only signaled when its command
 * line proves it is the recorded browser (guard against pid reuse).
 * Best-effort; never throws.
 */
export async function reapOrphanedBrowsers(): Promise<void> {
  let entries: string[];
  try {
    entries = readdirSync(ORPHAN_REGISTRY_DIR);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const filePath = join(ORPHAN_REGISTRY_DIR, entry);
    let record: OrphanRecord;
    try {
      record = JSON.parse(readFileSync(filePath, "utf8")) as OrphanRecord;
    } catch {
      continue;
    }
    const { chromePid, parentPid, userDataDir, ownsTempDir } = record;
    if (
      !Number.isInteger(chromePid) ||
      chromePid <= 0 ||
      !Number.isInteger(parentPid) ||
      parentPid <= 0 ||
      typeof userDataDir !== "string"
    ) {
      continue;
    }
    if (parentPid === process.pid) continue; // our own live launch
    if (pidIsAlive(parentPid)) continue; // owner still alive and responsible

    // The owner is dead. Decide whether the recorded Chrome still runs.
    let chromeAlive = pidIsAlive(chromePid);
    if (chromeAlive) {
      const args = await processArgumentsForCleanup(chromePid);
      if (args === undefined) {
        // Cannot verify the process identity (e.g. Windows): leave it alone.
        continue;
      }
      if (!hasOwnedProfileArgument(args, userDataDir)) {
        // The pid was recycled by an unrelated process; the recorded
        // Chrome is actually gone.
        chromeAlive = false;
      }
    }

    if (chromeAlive) {
      try {
        process.kill(chromePid, "SIGTERM");
      } catch {
        // already gone
      }
      const termDeadline = Date.now() + 2_000;
      while (pidIsAlive(chromePid) && Date.now() < termDeadline) {
        await delay(25);
      }
      if (pidIsAlive(chromePid)) {
        // SIGTERM may have exited the browser and allowed its pid to be
        // recycled. Re-prove the exact profile argv before SIGKILL.
        const args = await processArgumentsForCleanup(chromePid);
        if (args === undefined) continue;
        if (!hasOwnedProfileArgument(args, userDataDir)) {
          chromeAlive = false;
        } else {
          try {
            process.kill(chromePid, "SIGKILL");
          } catch {
            // already gone
          }
          const killDeadline = Date.now() + 1_000;
          while (pidIsAlive(chromePid) && Date.now() < killDeadline) {
            await delay(25);
          }
        }
      }
      if (chromeAlive && pidIsAlive(chromePid)) continue; // retry later
    }

    if (ownsTempDir && isOwnedTempProfileDir(userDataDir)) {
      try {
        rmSync(userDataDir, { recursive: true, force: true });
      } catch {
        continue; // keep the record so a later sweep can retry
      }
    }
    unregisterOrphanedBrowser(parentPid, chromePid, record.recordToken);
  }
}

export interface OwnedBrowserCleanup {
  process: ChildProcess;
  userDataDir: string;
  ownsTempDir: boolean;
  orphanToken: string;
  host?: string;
  port?: number;
  ownershipToken?: string;
}

interface ScheduledOwnedBrowserCleanup extends OwnedBrowserCleanup {
  attempts: number;
  running: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

const scheduledOwnedBrowserCleanups = new Map<
  string,
  ScheduledOwnedBrowserCleanup
>();

function scheduledCleanupKey(cleanup: OwnedBrowserCleanup): string {
  return `${cleanup.process.pid ?? "spawn-failed"}:${cleanup.orphanToken}`;
}

function armOwnedBrowserCleanup(task: ScheduledOwnedBrowserCleanup): void {
  if (task.timer || task.running) return;
  const delayMs = Math.min(5_000, 500 * 2 ** Math.min(task.attempts, 3));
  task.timer = setTimeout(() => {
    task.timer = undefined;
    void runOwnedBrowserCleanup(task);
  }, delayMs);
  task.timer.unref?.();
}

async function runOwnedBrowserCleanup(
  task: ScheduledOwnedBrowserCleanup
): Promise<void> {
  if (task.running) return;
  task.running = true;
  const key = scheduledCleanupKey(task);
  try {
    const exited = processExited(task.process) ||
      await terminateChromeProcess(task.process, 3_000);
    if (!exited) {
      if (
        task.host !== undefined &&
        task.port !== undefined &&
        task.ownershipToken !== undefined
      ) {
        noteOwnedBrowserDisconnected(
          task.host,
          task.port,
          task.ownershipToken
        );
      }
      task.attempts++;
      return;
    }

    if (
      task.host !== undefined &&
      task.port !== undefined &&
      task.ownershipToken !== undefined
    ) {
      releaseOwnedBrowserEndpoint(
        task.host,
        task.port,
        task.ownershipToken
      );
    }
    if (task.ownsTempDir) {
      try {
        await rm(task.userDataDir, { recursive: true, force: true });
      } catch {
        task.attempts++;
        return;
      }
    }
    if (typeof task.process.pid === "number") {
      if (!unregisterOrphanedBrowser(
        process.pid,
        task.process.pid,
        task.orphanToken
      )) {
        task.attempts++;
        return;
      }
    }
    scheduledOwnedBrowserCleanups.delete(key);
  } finally {
    task.running = false;
    if (scheduledOwnedBrowserCleanups.get(key) === task) {
      armOwnedBrowserCleanup(task);
    }
  }
}

/**
 * Retry cleanup retained by a failed launch rollback in the current process.
 * The unref'ed retry coexists with the durable orphan record: if this process
 * dies first, a later process reaps the same browser safely by argv identity.
 */
export function scheduleOwnedBrowserCleanup(
  cleanup: OwnedBrowserCleanup
): void {
  const key = scheduledCleanupKey(cleanup);
  const existing = scheduledOwnedBrowserCleanups.get(key);
  if (existing) {
    Object.assign(existing, cleanup);
    armOwnedBrowserCleanup(existing);
    return;
  }
  const task: ScheduledOwnedBrowserCleanup = {
    ...cleanup,
    attempts: 0,
    running: false,
  };
  scheduledOwnedBrowserCleanups.set(key, task);
  if (
    task.host !== undefined &&
    task.port !== undefined &&
    task.ownershipToken !== undefined
  ) {
    // Failed rollback invalidates the launch-time verification immediately;
    // a recycled foreign endpoint can never inherit a cached true result.
    noteOwnedBrowserDisconnected(task.host, task.port, task.ownershipToken);
  }
  armOwnedBrowserCleanup(task);
}

function captureStartupStderr(stream: Readable | null): {
  read: () => string;
  announcedEndpoint: () => DevToolsActivePort | null;
  stop: () => void;
} {
  const limit = 8_192;
  let tail = "";
  let announced: DevToolsActivePort | null = null;
  const readAnnouncement = (): DevToolsActivePort | null => {
    const matches = [...tail.matchAll(/DevTools listening on (ws:\/\/\S+)/g)];
    const value = matches.at(-1)?.[1];
    if (!value) return null;
    try {
      const endpoint = new URL(value);
      const port = Number(endpoint.port);
      if (
        endpoint.protocol !== "ws:" ||
        !Number.isInteger(port) ||
        port < 1 ||
        port > 65_535 ||
        !endpoint.pathname.startsWith("/devtools/browser/")
      ) {
        return null;
      }
      return { port, browserPath: endpoint.pathname };
    } catch {
      return null;
    }
  };
  const onData = (chunk: Buffer | string) => {
    tail += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    announced ??= readAnnouncement();
    if (tail.length > limit) tail = tail.slice(-limit);
  };
  stream?.on("data", onData);
  stream?.resume();
  return {
    read: () => tail.trim(),
    announcedEndpoint: () => announced ?? readAnnouncement(),
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
      proc.removeListener("close", onClose);
      resolve(value);
    };
    const onExit = () => finish(true);
    // "close" also fires when the process failed to spawn at all, a case
    // where "exit" never fires (spawn failure leaves exitCode null on Bun
    // and on Node's synchronous spawn-error path).
    const onClose = () => finish(true);
    const timer = setTimeout(() => finish(false), timeout);
    proc.once("exit", onExit);
    proc.once("close", onClose);
    if (processExited(proc)) finish(true);
  });
}

/** Stop an owned Chrome process within one total deadline. */
export async function terminateChromeProcess(
  proc: ChildProcess,
  timeoutMs = 4_000
): Promise<boolean> {
  if (processExited(proc)) return true;
  const totalTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : 1;
  const deadline = Date.now() + totalTimeout;
  try {
    proc.kill("SIGTERM");
  } catch {
    return processExited(proc);
  }
  const termBudget = Math.min(
    2_000,
    Math.max(1, Math.floor(totalTimeout * 2 / 3))
  );
  if (
    await waitForProcessExit(
      proc,
      Math.max(1, Math.min(termBudget, deadline - Date.now()))
    )
  ) {
    return true;
  }
  if (Date.now() >= deadline) return processExited(proc);
  try {
    proc.kill("SIGKILL");
  } catch {
    return processExited(proc);
  }
  return waitForProcessExit(proc, Math.max(1, deadline - Date.now()));
}

async function waitForLaunchedBrowser(
  proc: ChildProcess,
  requestedPort: number,
  userDataDir: string,
  timeout: number,
  readStderr: () => string,
  readAnnouncedEndpoint: () => DevToolsActivePort | null
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

    let active: DevToolsActivePort | null = null;
    try {
      active = readDevToolsActivePort(userDataDir);
      if (!active) malformedMarkerSince = undefined;
    } catch (error) {
      lastError = error;
      if (error instanceof ChromeLaunchError) {
        malformedMarkerSince ??= Date.now();
        if (Date.now() - malformedMarkerSince >= 250) throw error;
      }
    }

    try {
      const probeTimeout = Math.min(500, Math.max(1, deadline - Date.now()));
      let port: number;
      let browserPath: string;
      let targets: Awaited<ReturnType<typeof CDP.List>>;

      if (requestedPort === 0) {
        if (!active) {
          await delay(50);
          continue;
        }
        malformedMarkerSince = undefined;
        port = active.port;
        browserPath = active.browserPath;
        targets = await inspectMarkedEndpoint(
          active,
          probeTimeout,
          "Chrome readiness"
        );
      } else if (active) {
        malformedMarkerSince = undefined;
        if (active.port !== requestedPort) {
          throw new DevToolsEndpointMismatchError(
            `Launched profile reported DevTools port ${active.port}, expected ${requestedPort}`
          );
        }
        port = requestedPort;
        browserPath = active.browserPath;
        targets = await inspectMarkedEndpoint(
          active,
          probeTimeout,
          "Chrome readiness"
        );
      } else {
        // An explicit port can be stolen after the availability probe. Do not
        // trust /json/list alone: require the child process's own DevTools
        // announcement, then match its browser websocket identity to Version.
        const announced = readAnnouncedEndpoint();
        if (!announced) {
          lastError = new ChromeLaunchError(
            "Waiting for the launched Chrome process to identify its DevTools endpoint"
          );
          await delay(50);
          continue;
        }
        if (announced.port !== requestedPort) {
          throw new DevToolsEndpointMismatchError(
            `Launched Chrome announced DevTools port ${announced.port}, expected ${requestedPort}`
          );
        }
        port = requestedPort;
        browserPath = announced.browserPath;
        const [version, listedTargets] = await withTimeout(
          Promise.all([
            CDP.Version({ port, host: LOCAL_CDP_HOST, useHostName: true }),
            CDP.List({ port, host: LOCAL_CDP_HOST, useHostName: true }),
          ]),
          probeTimeout,
          "Chrome readiness"
        );
        const actualPath = browserPathFromVersion(version);
        if (actualPath !== browserPath) {
          throw new DevToolsEndpointMismatchError(
            `Launched Chrome browser endpoint ${browserPath} does not match ${actualPath}`
          );
        }
        targets = listedTargets;
      }

      const page = targets.find((target) => target.type === "page");
      if (page) {
        return {
          port,
          host: LOCAL_CDP_HOST,
          targetId: page.id,
          browserPath,
        };
      }
      lastError = new ChromeLaunchError(
        `Chrome is available on ${LOCAL_CDP_HOST}:${port}, but it has no page target`
      );
    } catch (error) {
      if (error instanceof DevToolsEndpointMismatchError) throw error;
      lastError = error;
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
  await reapOrphanedBrowsers();
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
  let orphanToken: string = randomUUID();
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
    // A failed spawn never fires "exit" on some runtimes; mark the process so
    // terminateChromeProcess does not stall waiting for a process that never
    // existed. This listener intentionally stays attached for the process
    // lifetime.
    launchedProcess.once("error", () => {
      spawnFailedProcesses.add(launchedProcess);
    });
    // Record ownership immediately after spawn. If startup rollback cannot
    // terminate the child, a later process still has enough bookkeeping to
    // reap it and preserve its profile.
    if (typeof launchedProcess.pid === "number") {
      orphanToken = registerOrphanedBrowser({
        chromePid: launchedProcess.pid,
        parentPid: process.pid,
        userDataDir,
        ownsTempDir,
        createdAt: Date.now(),
      });
    }
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
        stderr.read,
        stderr.announcedEndpoint
      ),
      spawnFailure,
    ]).finally(() => {
      if (onSpawnError) launchedProcess.removeListener("error", onSpawnError);
      stderr.stop();
    });
    const browserPath = endpoint.browserPath;
    if (!browserPath) {
      throw new ChromeLaunchError(
        "Could not prove that the DevTools endpoint belongs to the launched Chrome"
      );
    }
    const ownershipToken = registerOwnedBrowserEndpoint(
      endpoint.host,
      endpoint.port,
      browserPath
    );
    if (typeof launchedProcess.pid === "number") {
      updateOrphanedBrowserEndpoint(
        process.pid,
        launchedProcess.pid,
        orphanToken,
        {
          host: endpoint.host,
          port: endpoint.port,
          ownershipToken,
          browserWsPath: browserPath,
        }
      );
    }
    return {
      process: launchedProcess,
      ...endpoint,
      userDataDir,
      ownsTempDir,
      ownershipToken,
      orphanToken,
    };
  } catch (error) {
    const exited = proc ? await terminateChromeProcess(proc) : true;
    let profileCleanupError: unknown;
    let profileRemoved = !ownsTempDir;
    if (exited && ownsTempDir) {
      try {
        await rm(userDataDir, { recursive: true, force: true });
        profileRemoved = true;
      } catch (cleanupError) {
        profileCleanupError = cleanupError;
      }
    }
    let orphanRemoved = false;
    if (exited && profileRemoved && proc && typeof proc.pid === "number") {
      orphanRemoved = unregisterOrphanedBrowser(
        process.pid,
        proc.pid,
        orphanToken
      );
    }
    if (proc && (!exited || !profileRemoved || !orphanRemoved)) {
      scheduleOwnedBrowserCleanup({
        process: proc,
        userDataDir,
        ownsTempDir,
        orphanToken,
      });
    }

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
    if (profileCleanupError !== undefined) {
      throw new ChromeLaunchError(
        `${launchError.message}; failed to remove temporary profile ${userDataDir}`,
        {
          cause: new AggregateError(
            [launchError, profileCleanupError],
            "Chrome launch and profile cleanup failed"
          ),
        }
      );
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
