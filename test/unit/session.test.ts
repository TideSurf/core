import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { statSync, writeFileSync } from "node:fs";
import { connect as connectSocket } from "node:net";
import { join } from "node:path";
import {
  SESSION_PROTOCOL_VERSION,
  SessionProtocolError,
  ensureSession,
  getSessionPaths,
  isProcessRunning,
  readSessionState,
  removeSessionFiles,
  sendSessionRequest,
  validateSessionName,
  writeSessionState,
  type SessionConfig,
  type SessionState,
} from "../../src/cli/session.js";
import { runDaemon, type DaemonController } from "../../src/cli/daemon.js";

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
      browser: { running: boolean };
    }>(state, { method: "status" });
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
  it("validates portable session names", () => {
    expect(validateSessionName("agent_1.prod")).toBe("agent_1.prod");
    expect(() => validateSessionName("../escape")).toThrow(SessionProtocolError);
    expect(() => validateSessionName("space name")).toThrow(SessionProtocolError);
  });

  it("rejects protocol mismatch before opening a socket", async () => {
    await expect(
      sendSessionRequest(
        { ...state, protocol: SESSION_PROTOCOL_VERSION + 1 },
        { method: "ping" }
      )
    ).rejects.toThrow("uses protocol");
  });

  it("replaces state whose live PID has no socket", async () => {
    const staleName = `stale-${randomUUID()}`;
    const paths = getSessionPaths(staleName);
    writeSessionState(paths, {
      protocol: SESSION_PROTOCOL_VERSION,
      version: state.version,
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

  it("reads only structurally valid state", () => {
    const name = `state-${randomUUID()}`;
    const paths = getSessionPaths(name);
    try {
      writeFileSync(paths.stateFile, "{}\n", { mode: 0o600 });
      expect(readSessionState(paths)).toBeNull();
    } finally {
      removeSessionFiles(paths);
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
  });

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

  it("serializes tool work while health checks remain responsive", async () => {
    const name = `queue-${randomUUID()}`;
    const paths = getSessionPaths(name);
    const pending: SessionState = {
      protocol: SESSION_PROTOCOL_VERSION,
      version: state.version,
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
        input: { label: "a", delay: 100 },
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
});
