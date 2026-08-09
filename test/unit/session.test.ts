import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  existsSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { connect as connectSocket, createServer } from "node:net";
import { join } from "node:path";
import {
  SESSION_PROTOCOL_VERSION,
  SessionProtocolError,
  ensureSession,
  ensureSessionRequest,
  getSessionPaths,
  isProcessRunning,
  readSessionState,
  removeSessionFiles,
  removeSessionFilesIfCurrent,
  sendLiveSessionRequest,
  sendSessionRequest,
  validateSessionName,
  writeSessionState,
  type SessionConfig,
  type SessionState,
} from "../../src/cli/session.js";
import { runDaemon, type DaemonController } from "../../src/cli/daemon.js";
import { MAX_SESSION_EXECUTION_TIMEOUT_MS } from "../../src/cli/timeouts.js";
import { VERSION } from "../../src/version.js";

const root = join(import.meta.dir, "..", "..");
const entryPath = join(root, "src", "cli.ts");
const session = `unit-${randomUUID()}`;
const config: SessionConfig = {
  browserMode: "launch",
  headless: true,
  readOnly: false,
  allowLocalhost: false,
  allowPrivateHosts: false,
};
let state: SessionState;

function disconnectedState(
  name: string,
  protocol = SESSION_PROTOCOL_VERSION
): SessionState {
  return {
    protocol,
    version: VERSION,
    session: name,
    secret: "0".repeat(64),
    socketPath: "unused",
    config,
    pid: process.pid,
    ready: true,
  };
}

async function stop(candidate: SessionState | undefined): Promise<void> {
  if (candidate && isProcessRunning(candidate.pid)) {
    await sendSessionRequest(candidate, { method: "stop" }, 2_000).catch(() => undefined);
    const deadline = Date.now() + 5_000;
    while (isProcessRunning(candidate.pid) && Date.now() < deadline) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
    }
  }
  if (candidate) removeSessionFiles(getSessionPaths(candidate.session));
}

async function sendRawRequest(
  candidate: SessionState,
  request: unknown
): Promise<Record<string, unknown>> {
  const socket = connectSocket(candidate.socketPath);
  socket.setEncoding("utf8");
  await once(socket, "connect");
  socket.write(`${JSON.stringify(request)}\n`);
  return new Promise((resolveResponse, rejectResponse) => {
    let response = "";
    socket.on("data", (chunk: string) => {
      response += chunk;
      const newline = response.indexOf("\n");
      if (newline === -1) return;
      socket.destroy();
      try {
        resolveResponse(
          JSON.parse(response.slice(0, newline)) as Record<string, unknown>
        );
      } catch (error) {
        rejectResponse(error);
      }
    });
    socket.once("error", rejectResponse);
  });
}

describe("named session daemon", () => {
  beforeAll(async () => {
    state = await ensureSession({ session, config, entryPath });
  });

  afterAll(async () => {
    await stop(state);
  });

  it("creates one authenticated daemon", () => {
    expect(state.ready).toBe(true);
    expect(state.protocol).toBe(SESSION_PROTOCOL_VERSION);
    expect(state.secret).toHaveLength(64);
    expect(isProcessRunning(state.pid)).toBe(true);
  });

  it("answers authenticated pings", async () => {
    const result = await sendSessionRequest<{ pid: number }>(state, { method: "ping" });
    expect(result.pid).toBe(state.pid);
  });

  it("reports a stopped browser before the first tool", async () => {
    const result = await sendSessionRequest<{
      running: boolean;
      starting: boolean;
      ready: boolean;
      browser: { running: boolean };
    }>(state, { method: "status" });
    expect(result).toMatchObject({ running: true, starting: false, ready: true });
    expect(result.browser.running).toBe(false);
  });

  it("reuses the daemon during simultaneous startup", async () => {
    const sessions = await Promise.all([
      ensureSession({ session, config, entryPath }),
      ensureSession({ session, config, entryPath }),
      ensureSession({ session, config, entryPath }),
    ]);
    expect(new Set(sessions.map((candidate) => candidate.pid)).size).toBe(1);
    expect(new Set(sessions.map((candidate) => candidate.secret)).size).toBe(1);
  });

  it("rejects the wrong handshake secret", async () => {
    await expect(
      sendSessionRequest({ ...state, secret: "0".repeat(64) }, { method: "ping" })
    ).rejects.toThrow("authentication");
  });

  it("rejects malformed authenticated tool requests at the protocol boundary", async () => {
    const response = await sendRawRequest(state, {
      protocol: SESSION_PROTOCOL_VERSION,
      id: "malformed-tool",
      secret: state.secret,
      deadline: Date.now() + 1_000,
      executionTimeout: 500,
      request: { method: "tool", name: "get_state" },
    });
    expect(response).toMatchObject({
      id: "malformed-tool",
      success: false,
      errorType: "SessionProtocolError",
      error: "Invalid tool request",
    });
  });

  it("rejects conflicting immutable policy", async () => {
    await expect(
      ensureSession({
        session,
        entryPath,
        config: { ...config, readOnly: true },
        expectedConfig: { readOnly: true },
      })
    ).rejects.toThrow("different startup options");
  });

  it("compares only startup options repeated by a later invocation", async () => {
    await expect(
      ensureSession({
        session,
        entryPath,
        config: { ...config, allowLocalhost: true },
        expectedConfig: { readOnly: false },
      })
    ).resolves.toMatchObject({ pid: state.pid });
    await expect(
      ensureSession({
        session,
        entryPath,
        config,
        expectedConfig: { readOnly: true },
      })
    ).rejects.toThrow("different startup options");
  });

  it("handles concurrent health checks", async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        sendSessionRequest<{ pid: number }>(state, { method: "ping" })
      )
    );
    expect(results.every((result) => result.pid === state.pid)).toBe(true);
  });

  it("stores private state on Unix", () => {
    if (process.platform === "win32") return;
    const paths = getSessionPaths(session);
    expect(statSync(paths.stateFile).mode & 0o777).toBe(0o600);
    expect(statSync(paths.directory).mode & 0o777).toBe(0o700);
  });
});

describe("session recovery", () => {
  it("starts through a short private path when the Unix runtime path is too long", async () => {
    if (process.platform === "win32") return;
    const previousRuntime = process.env["XDG_RUNTIME_DIR"];
    const longRuntime = join("/tmp", `tidesurf-${"x".repeat(120)}`);
    const name = `long-path-${randomUUID()}`;
    let candidate: SessionState | undefined;
    let directory: string | undefined;
    process.env["XDG_RUNTIME_DIR"] = longRuntime;
    try {
      candidate = await ensureSession({ session: name, config, entryPath });
      directory = getSessionPaths(name).directory;
      expect(Buffer.byteLength(candidate.socketPath)).toBeLessThanOrEqual(100);
      expect(candidate.socketPath.startsWith(longRuntime)).toBe(false);
    } finally {
      await stop(candidate);
      if (directory) rmSync(directory, { recursive: true, force: true });
      if (previousRuntime === undefined) {
        delete process.env["XDG_RUNTIME_DIR"];
      } else {
        process.env["XDG_RUNTIME_DIR"] = previousRuntime;
      }
    }
  });

  it("uses the requested warm operation as the health check", async () => {
    const name = `single-request-${randomUUID()}`;
    const paths = getSessionPaths(name);
    const missingEntryPath = join(root, "test", "fixtures", "missing-cli.ts");
    const secret = "c".repeat(64);
    const daemonProcess = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { stdio: "ignore" }
    );
    await once(daemonProcess, "spawn");
    const daemonPid = daemonProcess.pid!;
    let connections = 0;
    const server = createServer((socket) => {
      connections++;
      socket.setEncoding("utf8");
      let body = "";
      socket.on("data", async (chunk: string) => {
        body += chunk;
        const newline = body.indexOf("\n");
        if (newline === -1) return;
        const request = JSON.parse(body.slice(0, newline)) as {
          id: string;
          request: { method: string };
        };
        if (request.request.method === "tool") {
          const exited = once(daemonProcess, "exit");
          daemonProcess.kill();
          await exited;
          socket.destroy();
          return;
        }
        socket.end(`${JSON.stringify({
          protocol: SESSION_PROTOCOL_VERSION,
          id: request.id,
          success: true,
          data: { method: request.request.method },
        })}\n`);
      });
    });

    server.listen(paths.socketPath);
    await once(server, "listening");
    writeSessionState(paths, {
      protocol: SESSION_PROTOCOL_VERSION,
      version: VERSION,
      session: name,
      secret,
      socketPath: paths.socketPath,
      config,
      pid: daemonPid,
      ready: true,
    });

    try {
      const response = await ensureSessionRequest<{ method: string }>(
        { session: name, config, entryPath: missingEntryPath },
        { method: "status" }
      );
      expect(response.data).toEqual({ method: "status" });
      expect(connections).toBe(1);

      await expect(
        ensureSessionRequest(
          { session: name, config, entryPath: missingEntryPath },
          { method: "tool", name: "click", input: { id: "B1" } }
        )
      ).rejects.toThrow();
      expect(connections).toBe(2);
      expect(readSessionState(paths)?.secret).toBe(secret);
    } finally {
      if (isProcessRunning(daemonPid)) {
        const exited = once(daemonProcess, "exit");
        daemonProcess.kill();
        await exited;
      }
      server.close();
      await once(server, "close");
      removeSessionFiles(paths, true);
    }
  });

  it("validates portable session names", () => {
    expect(validateSessionName("agent_1.prod")).toBe("agent_1.prod");
    expect(() => validateSessionName("../escape")).toThrow(SessionProtocolError);
    expect(() => validateSessionName("space name")).toThrow(SessionProtocolError);
  });

  it("rejects protocol mismatch before opening a socket", async () => {
    await expect(
      sendSessionRequest(
        disconnectedState(
          "protocol-mismatch",
          SESSION_PROTOCOL_VERSION + 1
        ),
        { method: "ping" }
      )
    ).rejects.toThrow("uses protocol");
  });

  it("rejects transport timeouts that would overflow the platform timer", async () => {
    await expect(
      sendSessionRequest(
        disconnectedState("timeout-overflow"),
        { method: "ping" },
        MAX_SESSION_EXECUTION_TIMEOUT_MS + 1
      )
    ).rejects.toThrow(`between 1 and ${MAX_SESSION_EXECUTION_TIMEOUT_MS}ms`);
  });

  it("replaces state whose live PID has no socket", async () => {
    const staleName = `stale-${randomUUID()}`;
    const paths = getSessionPaths(staleName);
    writeSessionState(paths, {
      protocol: SESSION_PROTOCOL_VERSION,
      version: VERSION,
      session: staleName,
      secret: "a".repeat(64),
      socketPath: paths.socketPath,
      config,
      pid: process.pid,
      ready: true,
    });

    let recovered: SessionState | undefined;
    try {
      recovered = await ensureSession({ session: staleName, config, entryPath });
      expect(recovered.pid).not.toBe(process.pid);
      expect(await sendSessionRequest(recovered, { method: "ping" })).toBeTruthy();
    } finally {
      await stop(recovered);
      removeSessionFiles(paths);
    }
  });

  it("recovers a startup lock owned by a dead process", async () => {
    const staleName = `lock-${randomUUID()}`;
    const paths = getSessionPaths(staleName);
    writeFileSync(paths.lockFile, "2147483647\n", { mode: 0o600 });
    let recovered: SessionState | undefined;
    try {
      recovered = await ensureSession({ session: staleName, config, entryPath });
      expect(recovered.ready).toBe(true);
    } finally {
      await stop(recovered);
      removeSessionFiles(paths);
    }
  });

  it("does not let stale generation cleanup delete replacement files", () => {
    const name = `generation-files-${randomUUID()}`;
    const paths = getSessionPaths(name);
    const oldState: SessionState = {
      protocol: SESSION_PROTOCOL_VERSION,
      version: VERSION,
      session: name,
      secret: "1".repeat(64),
      socketPath: paths.socketPath,
      config,
      pid: process.pid,
      ready: true,
      startupId: randomUUID(),
    };
    const replacement: SessionState = {
      ...oldState,
      secret: "2".repeat(64),
      ready: false,
      startupId: randomUUID(),
    };
    try {
      writeSessionState(paths, oldState);
      writeFileSync(paths.lockFile, `${JSON.stringify({
        pid: process.pid,
        startupId: oldState.startupId,
        createdAt: 1,
      })}\n`, { mode: 0o600 });
      writeFileSync(paths.logFile, "replacement log\n", { mode: 0o600 });
      if (process.platform !== "win32") {
        writeFileSync(paths.socketPath, "replacement socket sentinel", { mode: 0o600 });
      }

      writeSessionState(paths, replacement);
      writeFileSync(paths.lockFile, `${JSON.stringify({
        pid: process.pid,
        startupId: replacement.startupId,
        createdAt: 2,
      })}\n`, { mode: 0o600 });

      expect(removeSessionFilesIfCurrent(paths, oldState, true)).toBe(false);
      expect(readSessionState(paths)?.startupId).toBe(replacement.startupId);
      expect(JSON.parse(readFileSync(paths.lockFile, "utf8")).startupId).toBe(
        replacement.startupId
      );
      expect(readFileSync(paths.logFile, "utf8")).toContain("replacement log");
      if (process.platform !== "win32") {
        expect(readFileSync(paths.socketPath, "utf8")).toBe(
          "replacement socket sentinel"
        );
      }
    } finally {
      removeSessionFiles(paths, true);
    }
  });

  it("reads only structurally valid state", () => {
    const name = `state-${randomUUID()}`;
    const paths = getSessionPaths(name);
    try {
      writeFileSync(paths.stateFile, "{}\n", { mode: 0o600 });
      expect(readSessionState(paths)).toBeNull();
      writeFileSync(paths.stateFile, "{\n", { mode: 0o600 });
      expect(readSessionState(paths)).toBeNull();
    } finally {
      removeSessionFiles(paths);
    }
  });

  it("reports a live pending session as starting and makes stop explicit", async () => {
    const name = `starting-${randomUUID()}`;
    const paths = getSessionPaths(name);
    writeSessionState(paths, {
      protocol: SESSION_PROTOCOL_VERSION,
      version: VERSION,
      session: name,
      secret: "d".repeat(64),
      socketPath: paths.socketPath,
      config,
      pid: process.pid,
      ready: false,
      startupId: randomUUID(),
    });

    try {
      await expect(
        sendLiveSessionRequest(name, { method: "status" }, 25)
      ).resolves.toMatchObject({
        state: { ready: false },
        data: { session: name, running: true, starting: true, ready: false },
      });
      await expect(
        sendLiveSessionRequest(name, { method: "stop" }, 25)
      ).rejects.toThrow(`Session ${name} is still starting`);
    } finally {
      removeSessionFiles(paths, true);
    }
  });

  it("marks a transport timeout as an unknown outcome", async () => {
    const name = `timeout-${randomUUID()}`;
    const paths = getSessionPaths(name);
    const server = createServer((socket) => socket.resume());
    server.listen(paths.socketPath);
    await once(server, "listening");

    try {
      await expect(
        sendSessionRequest({
          protocol: SESSION_PROTOCOL_VERSION,
          version: VERSION,
          session: name,
          secret: "e".repeat(64),
          socketPath: paths.socketPath,
          config,
          pid: process.pid,
          ready: true,
        }, { method: "tool", name: "click", input: { id: "B1" } }, 25)
      ).rejects.toThrow("it may still complete, so inspect the session before retrying");
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
      removeSessionFiles(paths, true);
    }
  });

  it("starts exactly one daemon from a cold concurrent race", async () => {
    const name = `race-${randomUUID()}`;
    let candidates: SessionState[] = [];
    try {
      candidates = await Promise.all(
        Array.from({ length: 8 }, () =>
          ensureSession({ session: name, config, entryPath })
        )
      );
      expect(new Set(candidates.map((candidate) => candidate.pid)).size).toBe(1);
      expect(new Set(candidates.map((candidate) => candidate.secret)).size).toBe(1);
    } finally {
      await stop(candidates[0]);
    }
  });

  it("cannot join a simultaneous startup with conflicting policy", async () => {
    const name = `policy-${randomUUID()}`;
    let running: SessionState | undefined;
    try {
      const results = await Promise.allSettled([
        ensureSession({
          session: name,
          config,
          entryPath,
          expectedConfig: config,
        }),
        ensureSession({
          session: name,
          config: { ...config, readOnly: true },
          entryPath,
          expectedConfig: { ...config, readOnly: true },
        }),
      ]);
      const fulfilled = results.filter(
        (result): result is PromiseFulfilledResult<SessionState> =>
          result.status === "fulfilled"
      );
      const rejected = results.filter((result) => result.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(String(rejected[0].reason)).toContain("different startup options");
      running = fulfilled[0].value;
    } finally {
      await stop(running);
    }
  }, 20_000);

  it("shuts down on SIGTERM and removes session state", async () => {
    if (process.platform === "win32") return;
    const name = `signal-${randomUUID()}`;
    const candidate = await ensureSession({ session: name, config, entryPath });
    process.kill(candidate.pid, "SIGTERM");
    const deadline = Date.now() + 5_000;
    while (isProcessRunning(candidate.pid) && Date.now() < deadline) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
    }
    expect(isProcessRunning(candidate.pid)).toBe(false);
    expect(readSessionState(getSessionPaths(name))).toBeNull();
  });

  it("does not let an idle socket block stop", async () => {
    const name = `idle-${randomUUID()}`;
    const candidate = await ensureSession({ session: name, config, entryPath });
    const socket = connectSocket(candidate.socketPath);
    await once(socket, "connect");
    try {
      await expect(
        sendSessionRequest(candidate, { method: "stop" }, 2_000)
      ).resolves.toMatchObject({ stopped: true });
      const deadline = Date.now() + 5_000;
      while (isProcessRunning(candidate.pid) && Date.now() < deadline) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
      }
      expect(isProcessRunning(candidate.pid)).toBe(false);
    } finally {
      socket.destroy();
      removeSessionFiles(getSessionPaths(name), true);
    }
  });

  it("acknowledges stop only after browser and session cleanup", async () => {
    const name = `stop-cleanup-${randomUUID()}`;
    const paths = getSessionPaths(name);
    writeSessionState(paths, {
      protocol: SESSION_PROTOCOL_VERSION,
      version: VERSION,
      session: name,
      secret: "f".repeat(64),
      socketPath: paths.socketPath,
      config,
      pid: process.pid,
      ready: false,
      startupId: randomUUID(),
    });

    let releaseClose!: () => void;
    let markCloseStarted!: () => void;
    const closeGate = new Promise<void>((resolveClose) => {
      releaseClose = resolveClose;
    });
    const closeStarted = new Promise<void>((resolveStarted) => {
      markCloseStarted = resolveStarted;
    });
    const controller: DaemonController = {
      status: () => ({ running: false }),
      start: async () => ({ running: false }),
      execute: async () => ({ success: true }),
      close: async () => {
        markCloseStarted();
        await closeGate;
      },
    };

    await runDaemon(paths.stateFile, {
      controllerFactory: () => controller,
      installProcessHandlers: false,
    });
    const ready = readSessionState(paths)!;
    const request = sendSessionRequest<{ stopped: boolean }>(
      ready,
      { method: "stop" },
      2_000
    );
    let settled = false;
    void request.then(
      () => { settled = true; },
      () => { settled = true; }
    );

    try {
      await closeStarted;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
      expect(settled).toBe(false);
      expect(readSessionState(paths)).not.toBeNull();
      releaseClose();
      await expect(request).resolves.toMatchObject({ stopped: true });
      expect(readSessionState(paths)).toBeNull();
    } finally {
      releaseClose();
      await request.catch(() => undefined);
      removeSessionFiles(paths, true);
    }
  });

  it("does not let an old shutdown delete a replacement generation", async () => {
    const name = `shutdown-generation-${randomUUID()}`;
    const paths = getSessionPaths(name);
    const startupId = randomUUID();
    writeSessionState(paths, {
      protocol: SESSION_PROTOCOL_VERSION,
      version: VERSION,
      session: name,
      secret: "7".repeat(64),
      socketPath: paths.socketPath,
      config,
      pid: process.pid,
      ready: false,
      startupId,
    });

    let releaseClose!: () => void;
    let markCloseStarted!: () => void;
    const closeGate = new Promise<void>((resolveClose) => {
      releaseClose = resolveClose;
    });
    const closeStarted = new Promise<void>((resolveStarted) => {
      markCloseStarted = resolveStarted;
    });
    const controller: DaemonController = {
      status: () => ({ running: false }),
      start: async () => ({ running: false }),
      execute: async () => ({ success: true }),
      close: async () => {
        markCloseStarted();
        await closeGate;
      },
    };
    const previousExitCode = process.exitCode;

    await runDaemon(paths.stateFile, {
      controllerFactory: () => controller,
      installProcessHandlers: false,
    });
    const oldReady = readSessionState(paths)!;
    const stopping = sendSessionRequest<{ stopped: boolean }>(
      oldReady,
      { method: "stop" },
      2_000
    );

    try {
      await closeStarted;
      const replacement: SessionState = {
        ...oldReady,
        secret: "8".repeat(64),
        pid: process.pid,
        ready: false,
        startupId: randomUUID(),
      };
      writeSessionState(paths, replacement);
      writeFileSync(paths.lockFile, `${JSON.stringify({
        pid: process.pid,
        startupId: replacement.startupId,
        createdAt: Date.now(),
      })}\n`, { mode: 0o600 });
      writeFileSync(paths.logFile, "replacement diagnostics\n", { mode: 0o600 });

      releaseClose();
      await expect(stopping).resolves.toMatchObject({ stopped: true });
      expect(readSessionState(paths)?.startupId).toBe(replacement.startupId);
      expect(JSON.parse(readFileSync(paths.lockFile, "utf8")).startupId).toBe(
        replacement.startupId
      );
      expect(readFileSync(paths.logFile, "utf8")).toContain(
        "replacement diagnostics"
      );
    } finally {
      releaseClose();
      await stopping.catch(() => undefined);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
      process.exitCode = previousExitCode;
      removeSessionFiles(paths, true);
    }
  });

  it("acknowledges concurrent stop requests without dropping either socket", async () => {
    const name = `stop-concurrent-${randomUUID()}`;
    const paths = getSessionPaths(name);
    writeSessionState(paths, {
      protocol: SESSION_PROTOCOL_VERSION,
      version: VERSION,
      session: name,
      secret: "e".repeat(64),
      socketPath: paths.socketPath,
      config,
      pid: process.pid,
      ready: false,
      startupId: randomUUID(),
    });
    let closeCalls = 0;
    const controller: DaemonController = {
      status: () => ({ running: false }),
      start: async () => ({ running: false }),
      execute: async () => ({ success: true }),
      close: async () => { closeCalls++; },
    };

    await runDaemon(paths.stateFile, {
      controllerFactory: () => controller,
      installProcessHandlers: false,
    });
    const ready = readSessionState(paths)!;
    try {
      const [first, second] = await Promise.all([
        sendSessionRequest<{ stopped: boolean }>(ready, { method: "stop" }, 2_000),
        sendSessionRequest<{ stopped: boolean }>(ready, { method: "stop" }, 2_000),
      ]);
      expect(first.stopped).toBe(true);
      expect(second.stopped).toBe(true);
      expect(closeCalls).toBe(1);
    } finally {
      removeSessionFiles(paths, true);
    }
  });

  it("reports cleanup failure and preserves the daemon log", async () => {
    const name = `stop-failure-${randomUUID()}`;
    const paths = getSessionPaths(name);
    writeFileSync(paths.logFile, "shutdown diagnostics\n", { mode: 0o600 });
    writeSessionState(paths, {
      protocol: SESSION_PROTOCOL_VERSION,
      version: VERSION,
      session: name,
      secret: "0".repeat(64),
      socketPath: paths.socketPath,
      config,
      pid: process.pid,
      ready: false,
      startupId: randomUUID(),
    });
    const controller: DaemonController = {
      status: () => ({ running: false }),
      start: async () => ({ running: false }),
      execute: async () => ({ success: true }),
      close: async () => { throw new Error("close failed"); },
    };
    const previousExitCode = process.exitCode;
    const errorLog = spyOn(console, "error").mockImplementation(() => {});

    await runDaemon(paths.stateFile, {
      controllerFactory: () => controller,
      installProcessHandlers: false,
    });
    const ready = readSessionState(paths)!;
    try {
      await expect(
        sendSessionRequest(ready, { method: "stop" }, 2_000)
      ).rejects.toThrow("Session shutdown failed (browser shutdown: close failed)");
      expect(readSessionState(paths)).not.toBeNull();
      expect(existsSync(paths.logFile)).toBe(true);
      expect(readFileSync(paths.logFile, "utf8")).toContain("shutdown diagnostics");
    } finally {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
      errorLog.mockRestore();
      process.exitCode = previousExitCode;
      removeSessionFiles(paths, true);
    }
  });

  it("serializes tool work while health checks remain responsive", async () => {
    const name = `queue-${randomUUID()}`;
    const paths = getSessionPaths(name);
    const pending: SessionState = {
      protocol: SESSION_PROTOCOL_VERSION,
      version: VERSION,
      session: name,
      secret: "b".repeat(64),
      socketPath: paths.socketPath,
      config,
      pid: process.pid,
      ready: false,
      startupId: randomUUID(),
    };
    writeSessionState(paths, pending);

    const events: string[] = [];
    let active = 0;
    let maxActive = 0;
    const controller: DaemonController = {
      status: () => ({ running: false }),
      start: async () => ({ running: false }),
      execute: async (_name, input) => {
        const label = String(input["label"]);
        events.push(`start:${label}`);
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolveDelay) =>
          setTimeout(resolveDelay, Number(input["delay"] ?? 0))
        );
        active--;
        events.push(`end:${label}`);
        return { success: true, data: label };
      },
      close: async () => {},
    };

    await runDaemon(paths.stateFile, {
      controllerFactory: () => controller,
      installProcessHandlers: false,
    });
    const ready = readSessionState(paths)!;
    try {
      const first = sendSessionRequest(ready, {
        method: "tool",
        name: "test",
        input: { label: "a", delay: 40 },
      });
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
      const pingStarted = Date.now();
      await sendSessionRequest(ready, { method: "ping" });
      expect(Date.now() - pingStarted).toBeLessThan(75);
      const second = sendSessionRequest(ready, {
        method: "tool",
        name: "test",
        input: { label: "b", delay: 0 },
      });
      const cancelled = sendSessionRequest(ready, {
        method: "tool",
        name: "test",
        input: { label: "c", delay: 0 },
      }, 25);
      await expect(cancelled).rejects.toThrow("cancelled before execution");
      await Promise.all([first, second]);
      expect(maxActive).toBe(1);
      expect(events).toEqual(["start:a", "end:a", "start:b", "end:b"]);
      await sendSessionRequest(ready, { method: "stop" });
    } finally {
      const deadline = Date.now() + 2_000;
      while (readSessionState(paths) && Date.now() < deadline) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
      }
      removeSessionFiles(paths, true);
    }
  });

  it("runs browser-free tools outside the browser serialization queue", async () => {
    const name = `queue-browser-free-${randomUUID()}`;
    const paths = getSessionPaths(name);
    writeSessionState(paths, {
      protocol: SESSION_PROTOCOL_VERSION,
      version: VERSION,
      session: name,
      secret: "6".repeat(64),
      socketPath: paths.socketPath,
      config,
      pid: process.pid,
      ready: false,
      startupId: randomUUID(),
    });

    let releaseBrowser!: () => void;
    let markBrowserStarted!: () => void;
    const browserGate = new Promise<void>((resolveBrowser) => {
      releaseBrowser = resolveBrowser;
    });
    const browserStarted = new Promise<void>((resolveStarted) => {
      markBrowserStarted = resolveStarted;
    });
    const events: string[] = [];
    const controller: DaemonController = {
      status: () => ({ running: false }),
      start: async () => ({ running: false }),
      execute: async (name) => {
        events.push(`start:${name}`);
        if (name === "get_state") {
          markBrowserStarted();
          await browserGate;
        }
        events.push(`end:${name}`);
        return { success: true, data: name };
      },
      close: async () => {},
    };

    await runDaemon(paths.stateFile, {
      controllerFactory: () => controller,
      installProcessHandlers: false,
    });
    const ready = readSessionState(paths)!;
    const browserTool = sendSessionRequest(ready, {
      method: "tool",
      name: "get_state",
      input: {},
    }, 3_000);

    try {
      await browserStarted;
      const browserFree = sendSessionRequest<{ success: boolean; data: string }>(
        ready,
        { method: "tool", name: "list_skills", input: {} },
        1_000
      );
      await expect(browserFree).resolves.toMatchObject({
        success: true,
        data: "list_skills",
      });
      expect(events).toEqual([
        "start:get_state",
        "start:list_skills",
        "end:list_skills",
      ]);

      releaseBrowser();
      await expect(browserTool).resolves.toMatchObject({ success: true });
      await sendSessionRequest(ready, { method: "stop" }, 2_000);
    } finally {
      releaseBrowser();
      await browserTool.catch(() => undefined);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
      removeSessionFiles(paths, true);
    }
  });

  it("answers stop out-of-band while a long tool is still running", async () => {
    const name = `stop-oob-${randomUUID()}`;
    const paths = getSessionPaths(name);
    writeSessionState(paths, {
      protocol: SESSION_PROTOCOL_VERSION,
      version: VERSION,
      session: name,
      secret: "9".repeat(64),
      socketPath: paths.socketPath,
      config,
      pid: process.pid,
      ready: false,
      startupId: randomUUID(),
    });

    let releaseTool!: () => void;
    let markToolStarted!: () => void;
    const toolGate = new Promise<void>((resolveTool) => {
      releaseTool = resolveTool;
    });
    const toolStarted = new Promise<void>((resolveStarted) => {
      markToolStarted = resolveStarted;
    });
    const controller: DaemonController = {
      status: () => ({ running: false }),
      start: async () => ({ running: false }),
      execute: async () => {
        markToolStarted();
        await toolGate;
        return { success: true };
      },
      close: async () => {},
    };

    await runDaemon(paths.stateFile, {
      controllerFactory: () => controller,
      installProcessHandlers: false,
    });
    const ready = readSessionState(paths)!;
    const tool = sendSessionRequest(ready, {
      method: "tool",
      name: "long",
      input: {},
    }, 5_000);
    let toolSettled = false;
    void tool.then(
      () => { toolSettled = true; },
      () => { toolSettled = true; }
    );

    try {
      await toolStarted;
      // A queued stop would sit behind the gated tool until its own queue
      // deadline cancelled it; out-of-band stop answers immediately.
      const stopped = await sendSessionRequest<{ stopped: boolean }>(
        ready,
        { method: "stop" },
        2_000
      );
      expect(stopped.stopped).toBe(true);
      expect(toolSettled).toBe(false);
    } finally {
      releaseTool();
      await tool.catch(() => undefined);
      const deadline = Date.now() + 2_000;
      while (readSessionState(paths) && Date.now() < deadline) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
      }
      removeSessionFiles(paths, true);
    }
  });
});

describe("startup failure handling", () => {
  it("cleans a dead pending startup and retries once in the same ensure call", async () => {
    const name = `unit-${randomUUID()}`;
    const paths = getSessionPaths(name);
    const sleeper = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    const startupId = randomUUID();
    let recovered: SessionState | undefined;
    try {
      await once(sleeper, "spawn");
      if (typeof sleeper.pid !== "number") throw new Error("sleeper has no pid");
      writeSessionState(paths, {
        protocol: SESSION_PROTOCOL_VERSION,
        version: VERSION,
        session: name,
        secret: "0".repeat(64),
        socketPath: paths.socketPath,
        config,
        pid: sleeper.pid,
        ready: false,
        startupId,
      });
      writeFileSync(
        paths.lockFile,
        `${JSON.stringify({ pid: sleeper.pid, startupId, createdAt: Date.now() })}\n`,
        { mode: 0o600 }
      );
      setTimeout(() => {
        try {
          sleeper.kill("SIGKILL");
        } catch {
          // already gone
        }
      }, 200);

      const started = Date.now();
      recovered = await ensureSession({
        session: name,
        config,
        entryPath,
        timeoutMs: 10_000,
      });
      expect(recovered.ready).toBe(true);
      expect(recovered.pid).not.toBe(sleeper.pid);
      expect(Date.now() - started).toBeLessThan(8_000);
    } finally {
      try {
        sleeper.kill("SIGKILL");
      } catch {
        // already gone
      }
      await stop(recovered);
      removeSessionFiles(paths, true);
      rmSync(paths.lockFile, { force: true });
    }
  }, 15_000);
});
