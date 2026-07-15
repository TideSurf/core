import { createHash, randomBytes, randomUUID } from "node:crypto";
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
import { isValidSessionName, SESSION_NAME_ERROR } from "./session-name.js";

export const SESSION_PROTOCOL_VERSION = 2;
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const READY_POLL_INTERVAL_MS = 10;
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
  if (
    response["protocol"] !== SESSION_PROTOCOL_VERSION ||
    response["id"] !== id ||
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

export function getSessionPaths(sessionName: string): SessionPaths {
  const session = validateSessionName(sessionName);
  const directory = runtimeDirectory();
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
  const key = createHash("sha256")
    .update(`${directory}\0${session}`)
    .digest("hex")
    .slice(0, 20);
  const socketPath = process.platform === "win32"
    ? `\\\\.\\pipe\\tidesurf-${key}`
    : join(directory, `${key}.sock`);
  return {
    directory,
    socketPath,
    stateFile: join(directory, `${key}.json`),
    lockFile: join(directory, `${key}.lock`),
    logFile: join(directory, `${key}.log`),
  };
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
    if (
      state["socketPath"] !== paths.socketPath ||
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

export function writeSessionState(paths: SessionPaths, state: SessionState): void {
  const temporary = `${paths.stateFile}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  renameSync(temporary, paths.stateFile);
}

export function removeSessionFiles(paths: SessionPaths, removeLog = false): void {
  rmSync(paths.stateFile, { force: true });
  rmSync(paths.lockFile, { force: true });
  if (process.platform !== "win32") rmSync(paths.socketPath, { force: true });
  if (removeLog) rmSync(paths.logFile, { force: true });
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
  const id = randomUUID();
  const executionTimeout = Math.max(1, timeoutMs);
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
    await new Promise((resolveDelay) =>
      setTimeout(resolveDelay, READY_POLL_INTERVAL_MS)
    );
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

export async function ensureSession(
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
      removeSessionFiles(paths, true);
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
    removeSessionFiles(paths, true);
  }
  if (current?.ready && !isProcessRunning(current.pid)) {
    removeSessionFiles(paths, true);
  }

  let ownsLock = false;
  const startupId = randomUUID();
  try {
    const lockDeadline = Date.now() + timeoutMs;
    while (!ownsLock && Date.now() < lockDeadline) {
      try {
        writeFileSync(paths.lockFile, `${JSON.stringify({
          pid: process.pid,
          startupId,
          createdAt: Date.now(),
        } satisfies StartupLock)}\n`, {
          flag: "wx",
          mode: 0o600,
        });
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
        removeSessionFiles(paths, true);
      }
    }
    if (!ownsLock) throw new SessionProtocolError("Could not acquire the session startup lock");

    const secret = randomBytes(32).toString("hex");
    const pending: SessionState = {
      protocol: SESSION_PROTOCOL_VERSION,
      version: VERSION,
      session: options.session,
      secret,
      socketPath: paths.socketPath,
      config: options.config,
      pid: process.pid,
      ready: false,
      startupId,
    };
    writeSessionState(paths, pending);

    const entryPath = resolve(options.entryPath ?? process.argv[1]);
    if (!existsSync(entryPath)) {
      throw new SessionProtocolError(`Cannot locate TideSurf CLI entrypoint: ${entryPath}`);
    }

    const logFd = openSync(paths.logFile, "a", 0o600);
    if (process.platform !== "win32") chmodSync(paths.logFile, 0o600);
    try {
      const { spawn } = await import("node:child_process");
      const child = spawn(
        process.execPath,
        [entryPath, "__daemon", "--state-file", paths.stateFile],
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

    return verifyCompatibleSession(await waitForReady(paths, timeoutMs), options);
  } catch (error) {
    const state = readSessionState(paths);
    if (
      !state ||
      !isProcessRunning(state.pid) ||
      (state.startupId === startupId && state.pid === process.pid)
    ) {
      removeSessionFiles(paths);
    }
    throw error;
  } finally {
    if (ownsLock) rmSync(paths.lockFile, { force: true });
  }
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
      removeSessionFiles(paths, true);
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
    if (state) removeSessionFiles(paths);
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
    removeSessionFiles(paths);
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
