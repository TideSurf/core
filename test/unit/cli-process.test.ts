import { describe, expect, it } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import {
  SESSION_PROTOCOL_VERSION,
  ensureSession,
  getSessionPaths,
  isProcessRunning,
  readSessionState,
  removeSessionFiles,
  sendLiveSessionRequest,
  sendSessionRequest,
  writeSessionState,
  type SessionPaths,
  type SessionState,
} from "../../src/cli/session.js";
import { TOOL_REGISTRY } from "../../src/tools/registry.js";
import { DAEMON_COMMAND } from "../../src/cli/daemon-argv.js";
import { VERSION } from "../../src/version.js";

const root = join(import.meta.dir, "..", "..");

function cli(...args: string[]) {
  return runCli(args);
}

function cliWithInput(input: string, ...args: string[]) {
  return runCli(args, new TextEncoder().encode(input));
}

function runCli(args: string[], stdin?: Uint8Array) {
  const result = Bun.spawnSync({
    cmd: [process.execPath, join(root, "src", "cli.ts"), ...args],
    cwd: root,
    env: process.env,
    stdin,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

describe("CLI process behavior", () => {
  it("prints general help with no arguments", () => {
    const results = [cli(), cli("--help"), cli("help")];
    for (const result of results) {
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Stateful Chromium automation for agents");
      expect(result.stdout).toContain("get_state");
    }
    expect(new Set(results.map((result) => result.stdout)).size).toBe(1);
  });

  it("prints the package version", () => {
    for (const result of [cli("--version"), cli("-V")]) {
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it("generates tool help from registry metadata", () => {
    const result = cli("help", "navigate");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("tidesurf navigate <url>");
  });

  it("documents command-only screenshot output", () => {
    const result = cli("screenshot", "--help");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("--output <file|->");
  });

  it("documents the get_state full-page override", () => {
    const result = cli("get_state", "--help");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("--full-page");
  });

  it("lists exact canonical tool identifiers", () => {
    const text = cli("tools");
    expect(text.code).toBe(0);
    expect(text.stdout.trim().split("\n").map((line) => line.split("\t", 1)[0])).toEqual(
      TOOL_REGISTRY.map((tool) => tool.name)
    );

    const json = cli("tools", "--json");
    expect(json.code).toBe(0);
    const output = JSON.parse(json.stdout) as { success: boolean; data: unknown[] };
    expect(output.success).toBe(true);
    expect(output.data).toHaveLength(18);
  });

  it("uses exit 2 for an unknown command", () => {
    for (const result of [cli("not-a-command"), cli("help", "not-a-command")]) {
      expect(result.code).toBe(2);
      expect(result.stderr).toContain("Unknown command");

      const names = result.stderr
        .match(/Available commands: ([^.]+)\./)?.[1]
        ?.split(", ");
      expect(names).toEqual([
        "start",
        "status",
        "stop",
        "tools",
        "call",
        "inspect",
        "mcp",
        "help",
        ...TOOL_REGISTRY.map((tool) => tool.name),
      ]);
    }
  });

  it("validates inspect before starting a browser", () => {
    const invalid = cli("inspect", "not-a-url");
    expect(invalid.code).toBe(2);
    expect(invalid.stderr).toContain("Invalid URL");

    const readOnly = cli("inspect", "https://example.com", "--read-only");
    expect(readOnly.code).toBe(4);
    expect(readOnly.stderr).toContain('Tool "navigate" is disabled');
  });

  it("lists canonical tool names when call receives an unknown tool", () => {
    const result = cli("call", "not-a-tool", "--input", "{}");
    expect(result.code).toBe(2);

    const names = result.stderr
      .match(/Available tools: ([^.]+)\./)?.[1]
      ?.split(", ");
    expect(names).toEqual(TOOL_REGISTRY.map((tool) => tool.name));
  });

  it("validates literal and stdin JSON call input before browser startup", () => {
    for (const result of [
      cli("call", "get_state", "--input", "not-json"),
      cli("call", "get_state", "--input", "[]"),
      cliWithInput("null", "call", "get_state", "--input", "-"),
    ]) {
      expect(result.code).toBe(2);
      expect(result.stderr).toMatch(/Invalid JSON input|JSON object/);
    }
  });

  it("keeps explicitly disabled JSON errors in text format", () => {
    for (const args of [
      ["--json=false", "not-a-command"],
      ["--json", "false", "not-a-command"],
      ["--no-json", "not-a-command"],
    ]) {
      const result = cli(...args);
      expect(result.code).toBe(2);
      expect(result.stderr).toStartWith("tidesurf: Unknown command");
      expect(result.stderr).toContain("Run 'tidesurf help' for usage.");
    }
  });

  it("honors explicit values on the negated JSON flag in error output", () => {
    const disabled = cli("--no-json=true", "not-a-command");
    expect(disabled.code).toBe(2);
    expect(disabled.stderr).toStartWith("tidesurf: Unknown command");

    for (const args of [
      ["--no-json=false", "not-a-command"],
      ["--no-json", "false", "not-a-command"],
    ]) {
      const enabled = cli(...args);
      expect(enabled.code).toBe(2);
      expect(JSON.parse(enabled.stderr)).toMatchObject({
        success: false,
        errorType: "CliUsageError",
      });
    }
  });

  it("keeps enabled JSON errors structured", () => {
    const result = cli("--json=true", "not-a-command");
    expect(result.code).toBe(2);
    expect(JSON.parse(result.stderr)).toMatchObject({
      success: false,
      errorType: "CliUsageError",
    });
  });

  it("uses exit 2 for malformed numeric options", () => {
    const result = cli("--port", "9x", "status");
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("finite number");
  });

  it("rejects timeout budgets that exceed the session transport timer", () => {
    for (const args of [
      ["--session", `timeout-${crypto.randomUUID()}`, "--timeout", "200000000", "get_state"],
      ["--session", `timeout-${crypto.randomUUID()}`, "download", "B1", "--timeout", "1100000000"],
    ]) {
      const result = cli(...args);
      expect(result.code).toBe(2);
      expect(result.stderr).toContain("session transport limit");
    }
  });

  it("rejects conflicting page-state options before browser startup", () => {
    const result = cli("get_state", "--viewport", "--full-page");
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("conflicts");
  });

  it("rejects binary and JSON screenshot output together", () => {
    const result = cli("screenshot", "--output", "-", "--json");
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("cannot be combined");
  });

  it("makes stop idempotent for a missing session", () => {
    const session = `missing-${crypto.randomUUID()}`;
    const result = cli("--session", session, "stop", "--json");
    expect(result.code).toBe(0);
    const output = JSON.parse(result.stdout) as {
      success: boolean;
      data: { alreadyStopped: boolean };
    };
    expect(output.success).toBe(true);
    expect(output.data.alreadyStopped).toBe(true);
  });

  it("reports a live pending session as starting", () => {
    const session = `starting-${crypto.randomUUID()}`;
    const paths = getSessionPaths(session);
    writeSessionState(paths, {
      protocol: SESSION_PROTOCOL_VERSION,
      version: VERSION,
      session,
      secret: "b".repeat(64),
      socketPath: paths.socketPath,
      config: {
        browserMode: "launch",
        headless: true,
        readOnly: false,
        allowLocalhost: false,
        allowPrivateHosts: false,
      },
      pid: process.pid,
      ready: false,
      startupId: crypto.randomUUID(),
    });

    try {
      const result = cli("--session", session, "status", "--json");
      expect(result.code).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        success: true,
        data: { session, running: true, starting: true, ready: false },
      });
    } finally {
      removeSessionFiles(paths, true);
    }
  });

  it("rejects new read-only mutations without starting a session", () => {
    const session = `readonly-new-${crypto.randomUUID()}`;
    const result = cli(
      "--session",
      session,
      "--read-only",
      "click",
      "B1"
    );
    expect(result.code).toBe(4);
    expect(result.stderr).toContain("disabled in read-only mode");

    const malformed = cli(
      "--session",
      session,
      "--read-only",
      "click",
      "not-an-id"
    );
    expect(malformed.code).toBe(4);
    expect(malformed.stderr).toContain("disabled in read-only mode");

    const status = cli("--session", session, "status", "--json");
    expect(JSON.parse(status.stdout)).toMatchObject({
      success: true,
      data: { session, running: false },
    });
  });

  it("fails the daemon bootstrap without a startup token", () => {
    const result = cli("__daemon", "--state-file", "/nonexistent/state.json");
    expect(result.code).toBe(5);
    expect(result.stderr).toContain("--startup-token");
  });

  it("uses an authenticated session's immutable read-only policy", async () => {
    const session = `readonly-existing-${crypto.randomUUID()}`;
    const paths = getSessionPaths(session);
    const ready = await ensureSession({
      session,
      config: {
        browserMode: "launch",
        headless: true,
        readOnly: true,
        allowLocalhost: false,
        allowPrivateHosts: false,
      },
      entryPath: join(root, "src", "cli.ts"),
    });
    try {
      const result = cli("--session", session, "click", "B1");
      expect(result.code).toBe(4);
      expect(result.stderr).toContain("disabled in read-only mode");
    } finally {
      await sendSessionRequest(ready, { method: "stop" }, 2_000)
        .catch(() => undefined);
      removeSessionFiles(paths, true);
    }
  });
});

describe("orphaned daemon recovery", () => {
  async function spawnFakeDaemon(stateFile?: string): Promise<ChildProcess> {
    // The fake daemon must carry the daemon argv markers: terminateDaemon
    // verifies the victim's command line before signaling it, so a bare
    // sleeper process (no __daemon marker) is correctly left alone.
    const args = stateFile
      ? [
          "-e",
          "setInterval(() => {}, 1000)",
          DAEMON_COMMAND,
          "--state-file",
          stateFile,
          "--startup-token",
          "test",
        ]
      : ["-e", "setInterval(() => {}, 1000)"];
    const child = spawn(process.execPath, args, { stdio: "ignore" });
    await once(child, "spawn");
    return child;
  }

  async function awaitExit(child: ChildProcess): Promise<void> {
    if (child.exitCode === null && child.signalCode === null) {
      await Promise.race([
        once(child, "exit"),
        new Promise((resolveDelay) => setTimeout(resolveDelay, 8_000)),
      ]);
    }
  }

  function orphanReadyState(session: string, paths: SessionPaths, pid: number): SessionState {
    return {
      protocol: SESSION_PROTOCOL_VERSION,
      version: VERSION,
      session,
      secret: "a".repeat(64),
      socketPath: paths.socketPath,
      config: {
        browserMode: "launch",
        headless: true,
        readOnly: false,
        allowLocalhost: false,
        allowPrivateHosts: false,
      },
      pid,
      ready: true,
    };
  }

  it("stop terminates a live daemon whose socket vanished", async () => {
    const session = `orphan-stop-${crypto.randomUUID()}`;
    const paths = getSessionPaths(session);
    const fake = await spawnFakeDaemon(paths.stateFile);
    writeSessionState(paths, orphanReadyState(session, paths, fake.pid!));
    try {
      const response = await sendLiveSessionRequest(session, { method: "stop" }, 5_000);
      expect(response).toBeNull();
      await awaitExit(fake);
      expect(isProcessRunning(fake.pid!)).toBe(false);
      expect(readSessionState(paths)).toBeNull();
    } finally {
      fake.kill("SIGKILL");
      removeSessionFiles(paths, true);
    }
  }, 20_000);

  it("never terminates a foreign process holding a recycled daemon pid", async () => {
    // A daemon that died without cleanup leaves its state file behind; when
    // the OS recycles the pid, the sleeper on that pid must NOT be signaled.
    const session = `orphan-foreign-${crypto.randomUUID()}`;
    const paths = getSessionPaths(session);
    const foreign = await spawnFakeDaemon(); // no daemon argv markers
    writeSessionState(paths, orphanReadyState(session, paths, foreign.pid!));
    try {
      const response = await sendLiveSessionRequest(session, { method: "stop" }, 5_000);
      expect(response).toBeNull();
      // Give the recovery path time to (wrongly) signal the process.
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
      expect(isProcessRunning(foreign.pid!)).toBe(true);
      expect(readSessionState(paths)).toBeNull();
    } finally {
      foreign.kill("SIGKILL");
      removeSessionFiles(paths, true);
    }
  }, 20_000);

  it("terminates a live orphan before starting a replacement daemon", async () => {
    const session = `orphan-recover-${crypto.randomUUID()}`;
    const paths = getSessionPaths(session);
    const fake = await spawnFakeDaemon(paths.stateFile);
    writeSessionState(paths, orphanReadyState(session, paths, fake.pid!));
    let recovered: SessionState | undefined;
    try {
      recovered = await ensureSession({
        session,
        config: {
          browserMode: "launch",
          headless: true,
          readOnly: false,
          allowLocalhost: false,
          allowPrivateHosts: false,
        },
        entryPath: join(root, "src", "cli.ts"),
      });
      expect(recovered.pid).not.toBe(fake.pid);
      await awaitExit(fake);
      expect(isProcessRunning(fake.pid!)).toBe(false);
      expect(await sendSessionRequest(recovered, { method: "ping" }, 2_000)).toBeTruthy();
    } finally {
      if (recovered) {
        await sendSessionRequest(recovered, { method: "stop" }, 5_000).catch(() => undefined);
      }
      fake.kill("SIGKILL");
      removeSessionFiles(paths, true);
    }
  }, 30_000);
});
