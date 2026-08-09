import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFile, type ChildProcess } from "node:child_process";
import {
  closeSync,
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { connect as connectSocket } from "node:net";
import type { ChromeChannel, ToolResult } from "../types.js";
import { VERSION } from "../version.js";
import { buildDaemonArgv, matchesDaemonArgv } from "./daemon-argv.js";
import { isValidSessionName, SESSION_NAME_ERROR } from "./session-name.js";
import { MAX_SESSION_EXECUTION_TIMEOUT_MS } from "./timeouts.js";

export const SESSION_PROTOCOL_VERSION = 2;
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const READY_POLL_INITIAL_MS = 25;
const READY_POLL_MAX_MS = 250;
const MAX_UNIX_SOCKET_PATH_BYTES = 100;
const SENT_REQUEST_ERRORS = new WeakSet<object>();

export interface SessionConfig {
  browserMode: "launch" | "auto" | "connect";
  headless: boolean;
  host?: string;
  port?: number;
  browserUrl?: string;
  chromePath?: string;
  channel?: ChromeChannel;
  userDataDir?: string;
  timeout?: number;
  readOnly: boolean;
  allowLocalhost: boolean;
  allowPrivateHosts: boolean;
  fileAccessRoots?: string[];
}

export interface SessionState {
  protocol: number;
  version: string;
  session: string;
  secret: string;
  socketPath: string;
  config: SessionConfig;
  pid: number;
  ready: boolean;
  startupId?: string;
  startedAt?: string;
}

export interface SessionPaths {
  directory: string;
  stateFile: string;
  lockFile: string;
  mutationFile: string;
  logFile: string;
  socketPath: string;
}

export type SessionRequest =
  | { method: "ping" }
  | { method: "start" }
  | { method: "status" }
  | { method: "stop" }
  | { method: "tool"; name: string; input: Record<string, unknown> };

interface WireRequest {
  protocol: number;
  id: string;
  secret: string;
  deadline: number;
  executionTimeout: number;
  request: SessionRequest;
}

interface WireResponse<T = unknown> {
  protocol: number;
  id: string;
  success: boolean;
  data?: T;
  error?: string;
  errorType?: string;
}

function parseWireResponse<T>(raw: string, id: string): WireResponse<T> {
  const value: unknown = JSON.parse(raw);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SessionProtocolError("Session returned an invalid response");
  }
  const response = value as Record<string, unknown>;
  // The daemon answers requests it cannot parse (for example oversize
  // frames) with id "", so an id-less error frame is terminal for this
  // request rather than a protocol mismatch.
  const idMatches = response["id"] === id ||
    (response["id"] === "" && response["success"] === false);
  if (
    response["protocol"] !== SESSION_PROTOCOL_VERSION ||
    !idMatches ||
    typeof response["success"] !== "boolean"
  ) {
    throw new SessionProtocolError(
      "Session protocol response did not match the request"
    );
  }
  if (
    response["error"] !== undefined &&
    typeof response["error"] !== "string"
  ) {
    throw new SessionProtocolError("Session returned an invalid error response");
  }
  if (
    response["errorType"] !== undefined &&
    typeof response["errorType"] !== "string"
  ) {
    throw new SessionProtocolError("Session returned an invalid error response");
  }
  return response as unknown as WireResponse<T>;
}

export class SessionProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionProtocolError";
  }
}

export class SessionStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionStateError";
  }
}

class DeadSessionStartupError extends SessionProtocolError {
  readonly state: SessionState;

  constructor(state: SessionState, logFile: string) {
    super(
      `Session daemon ${state.pid} exited before becoming ready. Log: ${logFile}`
    );
    this.state = state;
  }
}

export function validateSessionName(name: string): string {
  if (!isValidSessionName(name)) throw new SessionProtocolError(SESSION_NAME_ERROR);
  return name;
}

function runtimeDirectory(): string {
  if (process.platform === "win32") {
    return process.env["LOCALAPPDATA"]
      ? join(process.env["LOCALAPPDATA"], "TideSurf", "sessions")
      : join(tmpdir(), "TideSurf", "sessions");
  }

  const runtime = process.env["XDG_RUNTIME_DIR"];
  if (runtime) return join(runtime, "tidesurf");
  const uid = process.getuid?.() ?? createHash("sha256")
    .update(process.env["HOME"] ?? process.env["USER"] ?? "user")
    .digest("hex")
    .slice(0, 12);
  return join(tmpdir(), `tidesurf-${uid}`);
}

function sessionKey(directory: string, session: string): string {
  return createHash("sha256")
    .update(`${directory}\0${session}`)
    .digest("hex")
    .slice(0, 20);
}

export function getSessionPaths(sessionName: string): SessionPaths {
  const session = validateSessionName(sessionName);
  let directory = runtimeDirectory();
  let key = sessionKey(directory, session);
  if (
    process.platform !== "win32" &&
    Buffer.byteLength(join(directory, `${key}.g-${"x".repeat(10)}.sock`)) >
      MAX_UNIX_SOCKET_PATH_BYTES
  ) {
    const owner = process.getuid?.() ?? "user";
    const namespace = createHash("sha256")
      .update(directory)
      .digest("hex")
      .slice(0, 12);
    directory = join("/tmp", `tidesurf-${owner}-${namespace}`);
    key = sessionKey(directory, session);
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stats = lstatSync(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new SessionProtocolError(`Session runtime path is not a private directory: ${directory}`);
  }
  if (process.platform !== "win32") {
    const uid = process.getuid?.();
    if (uid !== undefined && stats.uid !== uid) {
      throw new SessionProtocolError(`Session runtime directory has the wrong owner: ${directory}`);
    }
    if ((stats.mode & 0o777) !== 0o700) chmodSync(directory, 0o700);
  }
  const socketPath = process.platform === "win32"
    ? `\\\\.\\pipe\\tidesurf-${key}`
    : join(directory, `${key}.sock`);
  return {
    directory,
    socketPath,
    stateFile: join(directory, `${key}.json`),
    lockFile: join(directory, `${key}.lock`),
    mutationFile: join(directory, `${key}.mutation`),
    logFile: join(directory, `${key}.log`),
  };
}

/** Give each daemon generation its own endpoint so late close is harmless. */
export function getSessionGenerationSocketPath(
  paths: SessionPaths,
  startupId: string
): string {
  const generation = createHash("sha256")
    .update(startupId)
    .digest("hex")
    .slice(0, 10);
  return process.platform === "win32"
    ? `${paths.socketPath}-${generation}`
    : paths.socketPath.replace(/\.sock$/, `.g-${generation}.sock`);
}

function isMissingOrMalformedJson(error: unknown): boolean {
  return error instanceof SyntaxError || (
    typeof error === "object" &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

export function readSessionState(paths: SessionPaths): SessionState | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(paths.stateFile, "utf8"));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    const state = parsed as Record<string, unknown>;
    const startupId = state["startupId"];
    const socketPath = state["socketPath"];
    const validSocketPath = socketPath === paths.socketPath || (
      typeof startupId === "string" &&
      socketPath === getSessionGenerationSocketPath(paths, startupId)
    );
    if (
      !validSocketPath ||
      typeof state["secret"] !== "string" ||
      !Number.isInteger(state["pid"]) ||
      (state["pid"] as number) <= 0 ||
      typeof state["protocol"] !== "number" ||
      typeof state["version"] !== "string" ||
      typeof state["session"] !== "string" ||
      typeof state["ready"] !== "boolean" ||
      typeof state["config"] !== "object" ||
      state["config"] === null ||
      Array.isArray(state["config"])
    ) {
      return null;
    }
    return parsed as SessionState;
  } catch (error) {
    if (isMissingOrMalformedJson(error)) return null;
    throw error;
  }
}

interface SessionMutationLease {
  readonly token: string;
  release(): void;
}

const MUTATION_LOCK_WAIT_MS = 500;
const MUTATION_RETRY_ARRAY = new Int32Array(new SharedArrayBuffer(4));

function tryAcquireSessionMutationLock(
  paths: SessionPaths
): SessionMutationLease | null {
  const token = randomUUID();
  let descriptor: number;
  try {
    descriptor = openSync(paths.mutationFile, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return null;
    throw error;
  }
  try {
    writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, token })}\n`);
  } catch (error) {
    closeSync(descriptor);
    rmSync(paths.mutationFile, { force: true });
    throw error;
  }
  closeSync(descriptor);
  let released = false;
  return {
    token,
    release: () => {
      if (released) return;
      released = true;
      // Cooperative publishers cannot replace an extant exclusive lock. The
      // token check also makes release fail closed if an external actor has
      // tampered with the lock path.
      try {
        const current = JSON.parse(
          readFileSync(paths.mutationFile, "utf8")
        ) as { token?: unknown };
        if (current.token === token) rmSync(paths.mutationFile, { force: true });
      } catch {
        // A missing or altered lock is never grounds to unlink another lease.
      }
    },
  };
}

function withSessionMutationLockSync<T>(
  paths: SessionPaths,
  operation: () => T
): T {
  const deadline = Date.now() + MUTATION_LOCK_WAIT_MS;
  let lease: SessionMutationLease | null = null;
  while (!(lease = tryAcquireSessionMutationLock(paths))) {
    if (Date.now() >= deadline) {
      throw new SessionStateError(
        `Session lifecycle mutation is busy: ${paths.stateFile}`
      );
    }
    Atomics.wait(MUTATION_RETRY_ARRAY, 0, 0, 2);
  }
  try {
    return operation();
  } finally {
    lease.release();
  }
}

async function acquireSessionMutationLock(
  paths: SessionPaths,
  timeoutMs: number
): Promise<SessionMutationLease> {
  const deadline = Date.now() + timeoutMs;
  let lease: SessionMutationLease | null = null;
  while (!(lease = tryAcquireSessionMutationLock(paths))) {
    if (Date.now() >= deadline) {
      throw new SessionStateError(
        `Session lifecycle mutation is busy: ${paths.stateFile}`
      );
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
  }
  return lease;
}

/**
 * Serialize an asynchronous endpoint publication with every state publisher
 * and remover. A crashed lease is deliberately not stolen: lifecycle
 * availability fails closed rather than risking a replacement generation.
 */
export async function withSessionMutationLock<T>(
  paths: SessionPaths,
  operation: () => T | Promise<T>,
  timeoutMs = 2_000
): Promise<T> {
  const lease = await acquireSessionMutationLock(paths, timeoutMs);
  try {
    return await operation();
  } finally {
    lease.release();
  }
}

function writeSessionStateUnlocked(
  paths: SessionPaths,
  state: SessionState
): void {
  const temporary = `${paths.stateFile}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
    renameSync(temporary, paths.stateFile);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function writeSessionState(paths: SessionPaths, state: SessionState): void {
  withSessionMutationLockSync(paths, () => writeSessionStateUnlocked(paths, state));
}

function isSameSessionGeneration(
  current: SessionState | null,
  expected: SessionState
): current is SessionState {
  return Boolean(
    current &&
    current.session === expected.session &&
    current.socketPath === expected.socketPath &&
    current.secret === expected.secret &&
    current.startupId === expected.startupId
  );
}

/** True while the canonical state file still belongs to `expected`. */
export function isSessionStateCurrent(
  paths: SessionPaths,
  expected: SessionState
): boolean {
  return isSameSessionGeneration(readSessionState(paths), expected);
}

/** Replace state only while the canonical file still belongs to this startup. */
export function writeSessionStateIfCurrent(
  paths: SessionPaths,
  expected: SessionState,
  next: SessionState
): boolean {
  return withSessionMutationLockSync(paths, () => {
    const lock = readStartupLock(paths);
    if (
      !isSameSessionGeneration(readSessionState(paths), expected) ||
      (lock !== null && lock.startupId !== expected.startupId)
    ) {
      return false;
    }
    writeSessionStateUnlocked(paths, next);
    return true;
  });
}

export function removeSessionFiles(paths: SessionPaths, removeLog = false): void {
  withSessionMutationLockSync(paths, () => {
    const current = readSessionState(paths);
    if (process.platform !== "win32") {
      if (current) rmSync(current.socketPath, { force: true });
      if (!current || current.socketPath !== paths.socketPath) {
        rmSync(paths.socketPath, { force: true });
      }
    }
    rmSync(paths.stateFile, { force: true });
    rmSync(paths.lockFile, { force: true });
    if (removeLog) rmSync(paths.logFile, { force: true });
  });
}

/**
 * Remove shared session artifacts only while they still belong to `expected`.
 * The ownership check and final mutations share one exclusive lease, while
 * the endpoint path itself is generation-specific.
 */
function removeSessionFilesIfCurrentUnlocked(
  paths: SessionPaths,
  expected: SessionState,
  removeLog: boolean
): boolean {
  const lock = readStartupLock(paths);
  if (
    !isSameSessionGeneration(readSessionState(paths), expected) ||
    (lock !== null && lock.startupId !== expected.startupId)
  ) {
    return false;
  }

  // The caller's mutation lease covers the ownership check and every final
  // unlink, closing the former generation-check TOCTOU window.
  if (process.platform !== "win32") {
    rmSync(expected.socketPath, { force: true });
  }
  if (removeLog) rmSync(paths.logFile, { force: true });
  rmSync(paths.stateFile, { force: true });
  removeStartupLockUnlocked(paths, expected.startupId);
  return true;
}

export function removeSessionFilesIfCurrent(
  paths: SessionPaths,
  expected: SessionState,
  removeLog = false
): boolean {
  return withSessionMutationLockSync(paths, () =>
    removeSessionFilesIfCurrentUnlocked(paths, expected, removeLog)
  );
}

/** Remove only this generation's startup lock. */
export function removeSessionLockIfCurrent(
  paths: SessionPaths,
  expected: SessionState
): boolean {
  return withSessionMutationLockSync(paths, () => {
    if (!isSessionStateCurrent(paths, expected)) return false;
    return removeStartupLockUnlocked(paths, expected.startupId);
  });
}

/**
 * Remove a stale Unix endpoint and publish a server only while `expected`
 * owns state. The async bind is covered by the same mutation lease as the
 * final unlink, so no replacement state publisher can enter that window.
 */
export async function publishSessionEndpointIfCurrent(
  paths: SessionPaths,
  expected: SessionState,
  publish: () => void | Promise<void>
): Promise<boolean> {
  return withSessionMutationLock(paths, async () => {
    if (!isSameSessionGeneration(readSessionState(paths), expected)) return false;
    const lock = readStartupLock(paths);
    if (lock !== null && lock.startupId !== expected.startupId) return false;
    if (process.platform !== "win32") {
      rmSync(expected.socketPath, { force: true });
    }
    await publish();
    return true;
  });
}

export function isProcessRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = typeof error === "object" && error !== null
      ? (error as NodeJS.ErrnoException).code
      : undefined;
    if (code === "EPERM") return true;
    if (code === "ESRCH") return false;
    throw error;
  }
}

const PROCESS_IDENTITY_QUERY_MS = 5_000;

function parsePosixCommandLine(commandLine: string): string[] | undefined {
  const argv: string[] = [];
  let token = "";
  let tokenStarted = false;
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (const character of commandLine.trim()) {
    if (escaped) {
      token += character;
      tokenStarted = true;
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaped = true;
      tokenStarted = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      else token += character;
      tokenStarted = true;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      tokenStarted = true;
      continue;
    }
    if (/\s/.test(character)) {
      if (tokenStarted) {
        argv.push(token);
        token = "";
        tokenStarted = false;
      }
      continue;
    }
    token += character;
    tokenStarted = true;
  }
  if (escaped) token += "\\";
  if (quote) return undefined;
  if (tokenStarted) argv.push(token);
  return argv;
}

// CommandLineToArgvW-compatible handling for quoted paths and backslashes.
function parseWindowsCommandLine(commandLine: string): string[] | undefined {
  const argv: string[] = [];
  let index = 0;
  while (index < commandLine.length) {
    while (/\s/.test(commandLine[index] ?? "")) index++;
    if (index >= commandLine.length) break;
    let token = "";
    let inQuotes = false;
    while (index < commandLine.length) {
      let backslashes = 0;
      while (commandLine[index] === "\\") {
        backslashes++;
        index++;
      }
      if (commandLine[index] === '"') {
        token += "\\".repeat(Math.floor(backslashes / 2));
        if (backslashes % 2 === 1) {
          token += '"';
        } else {
          inQuotes = !inQuotes;
        }
        index++;
        continue;
      }
      token += "\\".repeat(backslashes);
      const character = commandLine[index];
      if (character === undefined || (!inQuotes && /\s/.test(character))) break;
      token += character;
      index++;
    }
    if (inQuotes) return undefined;
    argv.push(token);
    while (/\s/.test(commandLine[index] ?? "")) index++;
  }
  return argv;
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
      },
      (error, stdout) => resolveOutput(error ? undefined : stdout)
    );
  });
}

async function processArgv(
  pid: number,
  deadline = Date.now() + PROCESS_IDENTITY_QUERY_MS
): Promise<string[] | undefined> {
  if (process.platform === "linux") {
    try {
      const commandLine = readFileSync(`/proc/${pid}/cmdline`, "utf8");
      const argv = commandLine.split("\0");
      if (argv.at(-1) === "") argv.pop();
      return argv.length > 0 ? argv : undefined;
    } catch {
      return undefined;
    }
  }

  if (process.platform === "win32") {
    // One asynchronous CIM query gets one absolute deadline. A timeout or
    // parse failure fails closed; it never blocks the event loop or retries
    // with a second independent five-second budget.
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
      : parseWindowsCommandLine(commandLine.trim());
  }

  const commandLine = await execFileText(
    "ps",
    ["-ww", "-p", String(pid), "-o", "command="],
    deadline
  );
  return commandLine === undefined
    ? undefined
    : parsePosixCommandLine(commandLine);
}

/** Confirm the complete daemon argv identity before signaling a stale pid. */
async function isExpectedDaemonProcess(
  state: SessionState,
  paths: SessionPaths
): Promise<boolean> {
  if (!state.startupId) return false;
  const argv = await processArgv(state.pid);
  return Boolean(argv && matchesDaemonArgv(argv, {
    stateFile: paths.stateFile,
    startupToken: state.startupId,
  }));
}

export type DaemonTerminationOutcome =
  | "not-running"
  | "terminated"
  | "identity-unverified"
  | "survived";

/**
 * Signal a recorded daemon only after proving its complete startup identity.
 * The explicit outcome forces callers to distinguish confirmed death from an
 * unverifiable or surviving live pid.
 */
export async function terminateDaemon(
  state: SessionState,
  paths: SessionPaths
): Promise<DaemonTerminationOutcome> {
  const { pid } = state;
  if (!isProcessRunning(pid)) return "not-running";
  if (pid === process.pid) return "identity-unverified";
  if (!(await isExpectedDaemonProcess(state, paths))) {
    return isProcessRunning(pid) ? "identity-unverified" : "not-running";
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return isProcessRunning(pid) ? "survived" : "terminated";
  }
  const termDeadline = Date.now() + 5_000;
  while (isProcessRunning(pid) && Date.now() < termDeadline) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  if (!isProcessRunning(pid)) return "terminated";

  // The pid can be recycled after SIGTERM. Re-read its complete argv before
  // escalating so SIGKILL is never sent on the strength of an old handle.
  if (!(await isExpectedDaemonProcess(state, paths))) {
    return isProcessRunning(pid) ? "identity-unverified" : "terminated";
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    return isProcessRunning(pid) ? "survived" : "terminated";
  }
  const killDeadline = Date.now() + 1_000;
  while (isProcessRunning(pid) && Date.now() < killDeadline) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  return isProcessRunning(pid) ? "survived" : "terminated";
}

function assertDaemonCanBeReplaced(
  state: SessionState,
  outcome: DaemonTerminationOutcome
): void {
  if (outcome === "terminated" || outcome === "not-running") return;
  const reason = outcome === "identity-unverified"
    ? "its command identity could not be verified"
    : "it survived SIGTERM and SIGKILL";
  throw new SessionStateError(
    `Refusing to replace live session daemon ${state.pid}: ${reason}`
  );
}

async function terminateDaemonForReplacement(
  state: SessionState,
  paths: SessionPaths
): Promise<void> {
  assertDaemonCanBeReplaced(state, await terminateDaemon(state, paths));
}

function removeEndpointFiles(
  paths: SessionPaths,
  state: SessionState
): boolean {
  return removeSessionFilesIfCurrent(paths, state);
}

function isStaleEndpointError(error: unknown): boolean {
  if (
    typeof error !== "object" ||
    error === null ||
    SENT_REQUEST_ERRORS.has(error)
  ) {
    return false;
  }
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ECONNREFUSED";
}

export async function sendSessionRequest<T = unknown>(
  state: SessionState,
  request: SessionRequest,
  timeoutMs = 60_000
): Promise<T> {
  if (state.protocol !== SESSION_PROTOCOL_VERSION) {
    throw new SessionProtocolError(
      `Session ${state.session} uses protocol ${state.protocol}; expected ${SESSION_PROTOCOL_VERSION}`
    );
  }
  if (
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > MAX_SESSION_EXECUTION_TIMEOUT_MS
  ) {
    throw new SessionProtocolError(
      `Session request timeout must be between 1 and ${MAX_SESSION_EXECUTION_TIMEOUT_MS}ms`
    );
  }
  const id = randomUUID();
  const executionTimeout = timeoutMs;
  const transportTimeout = executionTimeout * 2;
  const payload: WireRequest = {
    protocol: SESSION_PROTOCOL_VERSION,
    id,
    secret: state.secret,
    deadline: Date.now() + transportTimeout,
    executionTimeout,
    request,
  };

  return new Promise<T>((resolveRequest, rejectRequest) => {
    let settled = false;
    let requestSent = false;
    const chunks: string[] = [];
    let receivedBytes = 0;
    const socket = connectSocket(state.socketPath);
    socket.setEncoding("utf8");

    const finish = (error?: Error, value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) {
        if (requestSent) SENT_REQUEST_ERRORS.add(error);
        rejectRequest(error);
      }
      else resolveRequest(value as T);
    };

    const timer = setTimeout(() => {
      const delivery = requestSent
        ? " after it was sent; it may still complete, so inspect the session before retrying"
        : " before it was sent";
      finish(new SessionProtocolError(
        `Session request timed out after ${transportTimeout}ms${delivery}`
      ));
    }, transportTimeout);
    timer.unref?.();

    socket.once("connect", () => {
      try {
        requestSent = true;
        socket.write(`${JSON.stringify(payload)}\n`);
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
    socket.on("data", (chunk: string) => {
      receivedBytes += Buffer.byteLength(chunk);
      if (receivedBytes > MAX_RESPONSE_BYTES) {
        finish(new SessionProtocolError("Session response exceeded 64 MiB"));
        return;
      }
      chunks.push(chunk);
      if (!chunk.includes("\n")) return;
      const received = chunks.join("");
      const newline = received.indexOf("\n");

      try {
        const response = parseWireResponse<T>(received.slice(0, newline), id);
        if (!response.success) {
          const error = new SessionProtocolError(response.error ?? "Session request failed");
          error.name = response.errorType ?? error.name;
          finish(error);
          return;
        }
        finish(undefined, response.data as T);
      } catch (error) {
        finish(error instanceof Error ? error : new SessionProtocolError(String(error)));
      }
    });
    socket.once("error", (error) => finish(error));
    socket.once("end", () => {
      if (!settled) finish(new SessionProtocolError("Session closed without a response"));
    });
  });
}

async function waitForReady(
  paths: SessionPaths,
  timeoutMs: number
): Promise<SessionState> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  let deadSince: number | undefined;
  let pollInterval = READY_POLL_INITIAL_MS;
  while (Date.now() < deadline) {
    const state = readSessionState(paths);
    if (state && state.protocol !== SESSION_PROTOCOL_VERSION) {
      throw new SessionProtocolError(
        `Session ${state.session} uses protocol ${state.protocol}; expected ${SESSION_PROTOCOL_VERSION}`
      );
    }
    if (state?.ready && isProcessRunning(state.pid)) {
      try {
        await sendSessionRequest(state, { method: "ping" }, 500);
        return state;
      } catch (error) {
        lastError = error;
      }
    }
    // Fail fast when the recorded startup is definitively dead: a daemon
    // that exits before writing ready would otherwise burn the whole
    // timeout. The pending state written by the spawner carries the
    // spawner's pid, so never fast-fail our own pid; and give an orphaned
    // daemon (spawner killed mid-startup) a short grace window to write
    // ready itself before declaring the startup dead.
    if (
      state &&
      !state.ready &&
      state.pid !== process.pid &&
      !isProcessRunning(state.pid)
    ) {
      deadSince ??= Date.now();
      if (Date.now() - deadSince >= 500) {
        throw new DeadSessionStartupError(state, paths.logFile);
      }
    } else {
      deadSince = undefined;
    }
    // Back off exponentially: the daemon writes ready exactly once, so
    // aggressive sync-I/O polling buys nothing.
    await new Promise((resolveDelay) => setTimeout(resolveDelay, pollInterval));
    pollInterval = Math.min(pollInterval * 2, READY_POLL_MAX_MS);
  }
  throw new SessionProtocolError(
    `Session did not start within ${timeoutMs}ms${
      lastError instanceof Error ? `: ${lastError.message}` : ""
    }. Log: ${paths.logFile}`
  );
}

function matchesExpectedConfig(
  current: SessionConfig,
  expected: Partial<SessionConfig>
): boolean {
  return (Object.keys(expected) as Array<keyof SessionConfig>).every((key) => {
    const actualValue = current[key];
    const expectedValue = expected[key];
    if (!Array.isArray(actualValue) || !Array.isArray(expectedValue)) {
      return Object.is(actualValue, expectedValue);
    }
    return actualValue.length === expectedValue.length &&
      actualValue.every((value, index) => value === expectedValue[index]);
  });
}

function verifyCompatibleSession(
  state: SessionState,
  options: EnsureSessionOptions
): SessionState {
  if (state.protocol !== SESSION_PROTOCOL_VERSION) {
    throw new SessionProtocolError(
      `Session ${options.session} uses protocol ${state.protocol}; expected ${SESSION_PROTOCOL_VERSION}`
    );
  }
  if (state.version !== VERSION) {
    throw new SessionStateError(
      `Session ${options.session} uses TideSurf ${state.version}; stop it before using ${VERSION}`
    );
  }
  const expected = options.expectedConfig;
  if (expected && !matchesExpectedConfig(state.config, expected)) {
    throw new SessionStateError(
      `Session ${options.session} is already running with different startup options; stop it or choose another --session`
    );
  }
  return state;
}

interface StartupLock {
  pid: number;
  startupId: string;
  createdAt: number;
}

function readStartupLock(paths: SessionPaths): StartupLock | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(paths.lockFile, "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    const value = parsed as Record<string, unknown>;
    const pid = value["pid"];
    const startupId = value["startupId"];
    const createdAt = value["createdAt"];
    return Number.isInteger(pid) &&
      typeof startupId === "string" &&
      Number.isFinite(createdAt)
      ? { pid: pid as number, startupId, createdAt: createdAt as number }
      : null;
  } catch (error) {
    if (isMissingOrMalformedJson(error)) return null;
    throw error;
  }
}

function removeStartupLockUnlocked(
  paths: SessionPaths,
  startupId: string | undefined
): boolean {
  if (!startupId) return false;
  const latest = readStartupLock(paths);
  if (latest?.startupId !== startupId) return false;
  rmSync(paths.lockFile, { force: true });
  return true;
}

function removeStartupLock(
  paths: SessionPaths,
  startupId: string | undefined
): boolean {
  return withSessionMutationLockSync(paths, () =>
    removeStartupLockUnlocked(paths, startupId)
  );
}

// Delete only the exact lock instance we observed. A replacement startup can
// reuse the canonical path without an older finally block deleting its lock.
function removeObservedLock(
  paths: SessionPaths,
  observed: StartupLock | null
): void {
  withSessionMutationLockSync(paths, () => {
    const latest = readStartupLock(paths);
    if (observed) {
      if (
        !latest ||
        latest.pid !== observed.pid ||
        latest.startupId !== observed.startupId ||
        latest.createdAt !== observed.createdAt
      ) {
        return;
      }
    } else if (latest !== null) {
      return;
    }
    rmSync(paths.lockFile, { force: true });
  });
}

export interface EnsureSessionOptions {
  session: string;
  config: SessionConfig;
  entryPath?: string;
  timeoutMs?: number;
  expectedConfig?: Partial<SessionConfig>;
}

export interface SessionRequestResult<T> {
  state: SessionState;
  data: T;
}

async function ensureSessionAttempt(
  options: EnsureSessionOptions
): Promise<SessionState> {
  const paths = getSessionPaths(options.session);
  const timeoutMs = options.timeoutMs ?? 10_000;
  let current = readSessionState(paths);

  if (
    current &&
    current.protocol !== SESSION_PROTOCOL_VERSION &&
    isProcessRunning(current.pid)
  ) {
    throw new SessionProtocolError(
      `Session ${options.session} uses protocol ${current.protocol}; stop that process before using protocol ${SESSION_PROTOCOL_VERSION}`
    );
  }

  if (current?.ready && isProcessRunning(current.pid)) {
    try {
      await sendSessionRequest(current, { method: "ping" }, 500);
      return verifyCompatibleSession(current, options);
    } catch (error) {
      if (isProcessRunning(current.pid) && !isStaleEndpointError(error)) throw error;
      if (isProcessRunning(current.pid)) {
        await terminateDaemonForReplacement(current, paths);
      }
      removeEndpointFiles(paths, current);
    }
  }

  if (current && !current.ready && isProcessRunning(current.pid)) {
    const lock = readStartupLock(paths);
    if (
      lock &&
      lock.startupId === current.startupId &&
      Date.now() - lock.createdAt < timeoutMs
    ) {
      return verifyCompatibleSession(await waitForReady(paths, timeoutMs), options);
    }
    const latest = readSessionState(paths);
    if (latest?.ready && isProcessRunning(latest.pid)) {
      await sendSessionRequest(latest, { method: "ping" }, 500);
      return verifyCompatibleSession(latest, options);
    }
    await terminateDaemonForReplacement(current, paths);
    removeEndpointFiles(paths, current);
    removeObservedLock(paths, lock);
  }
  if (current?.ready && !isProcessRunning(current.pid)) {
    removeEndpointFiles(paths, current);
  }

  let ownsLock = false;
  let ownedLock: StartupLock | null = null;
  let ownedState: SessionState | null = null;
  const startupId = randomUUID();
  try {
    const lockDeadline = Date.now() + timeoutMs;
    while (!ownsLock && Date.now() < lockDeadline) {
      try {
        const candidateLock: StartupLock = {
          pid: process.pid,
          startupId,
          createdAt: Date.now(),
        };
        withSessionMutationLockSync(paths, () => {
          writeFileSync(paths.lockFile, `${JSON.stringify(candidateLock)}\n`, {
            flag: "wx",
            mode: 0o600,
          });
        });
        ownedLock = candidateLock;
        ownsLock = true;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EEXIST") throw error;
        const lock = readStartupLock(paths);
        current = readSessionState(paths);
        if (current?.ready && isProcessRunning(current.pid)) {
          return verifyCompatibleSession(current, options);
        }
        if (
          lock &&
          current?.startupId === lock.startupId &&
          !current.ready &&
          Date.now() - lock.createdAt < timeoutMs
        ) {
          return verifyCompatibleSession(
            await waitForReady(paths, Math.max(1, lockDeadline - Date.now())),
            options
          );
        }
        if (
          lock &&
          isProcessRunning(lock.pid) &&
          Date.now() - lock.createdAt < timeoutMs
        ) {
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
          continue;
        }
        if (current && !current.ready && isProcessRunning(current.pid)) {
          await terminateDaemonForReplacement(current, paths);
          removeEndpointFiles(paths, current);
        }
        removeObservedLock(paths, lock);
      }
    }
    if (!ownsLock) throw new SessionProtocolError("Could not acquire the session startup lock");

    // A rival startup can finish between the pre-lock checks and our lock
    // win; reuse it instead of clobbering its state with a second spawn.
    const raced = readSessionState(paths);
    if (raced?.ready && isProcessRunning(raced.pid)) {
      try {
        await sendSessionRequest(raced, { method: "ping" }, 500);
        return verifyCompatibleSession(raced, options);
      } catch (error) {
        if (isProcessRunning(raced.pid) && !isStaleEndpointError(error)) throw error;
        if (isProcessRunning(raced.pid)) {
          await terminateDaemonForReplacement(raced, paths);
        }
        removeEndpointFiles(paths, raced);
      }
    }

    const secret = randomBytes(32).toString("hex");
    const pending: SessionState = {
      protocol: SESSION_PROTOCOL_VERSION,
      version: VERSION,
      session: options.session,
      secret,
      socketPath: getSessionGenerationSocketPath(paths, startupId),
      config: options.config,
      pid: process.pid,
      ready: false,
      startupId,
    };
    writeSessionState(paths, pending);
    ownedState = pending;

    const entryPath = resolve(options.entryPath ?? process.argv[1]);
    if (!existsSync(entryPath)) {
      throw new SessionProtocolError(`Cannot locate TideSurf CLI entrypoint: ${entryPath}`);
    }

    const logFd = openSync(paths.logFile, "a", 0o600);
    if (process.platform !== "win32") chmodSync(paths.logFile, 0o600);
    let child!: ChildProcess;
    try {
      const { spawn } = await import("node:child_process");
      child = spawn(
        process.execPath,
        [entryPath, ...buildDaemonArgv({
          stateFile: paths.stateFile,
          startupToken: startupId,
        })],
        {
          detached: true,
          stdio: ["ignore", logFd, logFd],
          windowsHide: true,
          env: process.env,
        }
      );
      child.unref();
    } finally {
      closeSync(logFd);
    }

    let rejectChildExit!: (error: DeadSessionStartupError) => void;
    const childExit = new Promise<never>((_resolve, reject) => {
      rejectChildExit = reject;
    });
    const onChildExit = () => rejectChildExit(
      new DeadSessionStartupError(
        { ...pending, pid: child.pid ?? pending.pid },
        paths.logFile
      )
    );
    child.once("exit", onChildExit);
    child.once("error", onChildExit);
    if (child.exitCode !== null || child.signalCode !== null) onChildExit();
    try {
      return verifyCompatibleSession(
        await Promise.race([waitForReady(paths, timeoutMs), childExit]),
        options
      );
    } finally {
      child.removeListener("exit", onChildExit);
      child.removeListener("error", onChildExit);
    }
  } catch (error) {
    const state = readSessionState(paths);
    if (
      state &&
      ownedState &&
      isSameSessionGeneration(state, ownedState) &&
      (!isProcessRunning(state.pid) || state.pid === process.pid)
    ) {
      removeEndpointFiles(paths, ownedState);
    }
    throw error;
  } finally {
    if (ownsLock) removeObservedLock(paths, ownedLock);
  }
}

export async function ensureSession(
  options: EnsureSessionOptions
): Promise<SessionState> {
  const paths = getSessionPaths(options.session);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await ensureSessionAttempt(options);
    } catch (error) {
      if (!(error instanceof DeadSessionStartupError) || attempt > 0) throw error;
      // A joined or freshly spawned pending daemon died. Remove only that
      // generation and make one bounded retry within this ensureSession call.
      removeEndpointFiles(paths, error.state);
      removeStartupLock(paths, error.state.startupId);
    }
  }
  throw new SessionProtocolError("Session startup retry was exhausted");
}

/**
 * Reuse a healthy session and make its requested operation the health check.
 * Only connection failures known to happen before the request was sent may
 * enter stale recovery; an ambiguously completed operation is never retried.
 */
export async function ensureSessionRequest<T>(
  options: EnsureSessionOptions,
  request: SessionRequest,
  requestTimeoutMs = 60_000
): Promise<SessionRequestResult<T>> {
  const paths = getSessionPaths(options.session);
  const current = readSessionState(paths);
  if (current?.ready && isProcessRunning(current.pid)) {
    const compatible = verifyCompatibleSession(current, options);
    try {
      return {
        state: compatible,
        data: await sendSessionRequest<T>(compatible, request, requestTimeoutMs),
      };
    } catch (error) {
      if (!isStaleEndpointError(error)) throw error;
      if (isProcessRunning(compatible.pid)) {
        await terminateDaemonForReplacement(compatible, paths);
      }
      removeEndpointFiles(paths, compatible);
    }
  }

  const state = await ensureSession(options);
  return {
    state,
    data: await sendSessionRequest<T>(state, request, requestTimeoutMs),
  };
}

export async function sendLiveSessionRequest<T>(
  session: string,
  request: SessionRequest,
  timeoutMs = 60_000
): Promise<SessionRequestResult<T> | null> {
  const paths = getSessionPaths(session);
  const state = readSessionState(paths);
  const running = state ? isProcessRunning(state.pid) : false;
  if (
    state &&
    state.protocol !== SESSION_PROTOCOL_VERSION &&
    running
  ) {
    throw new SessionProtocolError(
      `Session ${session} uses protocol ${state.protocol}; expected ${SESSION_PROTOCOL_VERSION}`
    );
  }
  if (!state || !running) {
    if (state) removeSessionFilesIfCurrent(paths, state);
    return null;
  }
  if (!state.ready && request.method === "status") {
    return {
      state,
      data: {
        session,
        version: state.version,
        running: true,
        starting: true,
        ready: false,
        config: state.config,
      } as T,
    };
  }

  let ready = state;
  if (!ready.ready) {
    try {
      ready = await waitForReady(paths, timeoutMs);
    } catch (error) {
      throw new SessionStateError(
        `Session ${session} is still starting and could not accept ${request.method}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
  try {
    return {
      state: ready,
      data: await sendSessionRequest<T>(ready, request, timeoutMs),
    };
  } catch (error) {
    if (!isStaleEndpointError(error)) throw error;
    if (isProcessRunning(ready.pid)) {
      await terminateDaemonForReplacement(ready, paths);
    }
    removeSessionFilesIfCurrent(paths, ready);
    return null;
  }
}

export function toToolResult(value: unknown): ToolResult {
  if (
    typeof value === "object" &&
    value !== null &&
    "success" in value &&
    typeof (value as { success: unknown }).success === "boolean"
  ) {
    return value as ToolResult;
  }
  return { success: true, data: value };
}
