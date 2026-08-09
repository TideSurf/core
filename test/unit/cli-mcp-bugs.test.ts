import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  CliUsageError,
  buildToolInput,
  parseInvocation,
} from "../../src/cli/args.js";
import { BrowserController } from "../../src/cli/browser-controller.js";
import {
  DAEMON_COMMAND,
  buildDaemonArgv,
  parseDaemonArgv,
} from "../../src/cli/daemon-argv.js";
import { runDaemon, type DaemonController } from "../../src/cli/daemon.js";
import {
  SESSION_PROTOCOL_VERSION,
  getSessionPaths,
  readSessionState,
  removeSessionFiles,
  sendSessionRequest,
  writeSessionState,
  type SessionConfig,
  type SessionPaths,
  type SessionState,
} from "../../src/cli/session.js";
import { TOOL_REGISTRY } from "../../src/tools/registry.js";
import { validateExpression } from "../../src/validation.js";
import { VERSION } from "../../src/version.js";

describe("CLI parsing", () => {
  it("uses help semantics with no command", () => {
    const invocation = parseInvocation([]);
    expect(invocation.command).toBeUndefined();
    expect(invocation.session).toBe("default");
    expect(invocation.sessionConfig.browserMode).toBe("launch");
    expect(invocation.sessionConfig.headless).toBe(true);
  });

  it("parses version and command help", () => {
    expect(parseInvocation(["--version"]).version).toBe(true);
    const help = parseInvocation(["get_state", "--help"]);
    expect(help.help).toBe(true);
    expect(help.tool?.name).toBe("get_state");
  });

  it("uses canonical tool identifiers as direct commands", () => {
    for (const spec of TOOL_REGISTRY) {
      expect(parseInvocation([spec.name]).tool).toBe(spec);
    }
  });

  it("builds typed tool input", () => {
    const invocation = parseInvocation([
      "--session",
      "research",
      "get_state",
      "--max-tokens",
      "900",
      "--mode",
      "interactive",
      "--full-page",
      "--include-hidden",
    ]);
    expect(buildToolInput(invocation)).toEqual({
      maxTokens: 900,
      mode: "interactive",
      includeHidden: true,
      viewport: false,
    });
    expect(invocation.session).toBe("research");
  });

  it("does not apply a disabled boolean transform", () => {
    const explicitFalse = parseInvocation([
      "get_state",
      "--full-page=false",
    ]);
    const negated = parseInvocation(["get_state", "--no-full-page"]);

    expect(buildToolInput(explicitFalse)).toEqual({});
    expect(buildToolInput(negated)).toEqual({});
  });

  it("applies explicit values consistently to negated booleans", () => {
    expect(parseInvocation(["--no-json=true", "status"]).json).toBe(false);
    expect(parseInvocation(["--no-json=false", "status"]).json).toBe(true);
    expect(parseInvocation(["--no-json", "true", "status"]).json).toBe(false);
    expect(parseInvocation(["--no-json", "false", "status"]).json).toBe(true);

    expect(
      buildToolInput(parseInvocation(["get_state", "--no-viewport=false"]))
    ).toEqual({ viewport: true });
  });

  it("parses startup policy and repeated filesystem roots", () => {
    const invocation = parseInvocation([
      "--auto-connect",
      "--browser-url",
      "http://127.0.0.1:9333",
      "--channel",
      "beta",
      "--read-only",
      "--file-access-root",
      ".",
      "--file-access-root",
      "/tmp",
      "--file-access-root",
      ".",
      "start",
    ]);
    expect(invocation.sessionConfig.browserMode).toBe("auto");
    expect(invocation.sessionConfig.browserUrl).toBe("http://127.0.0.1:9333");
    expect(invocation.sessionConfig.channel).toBe("beta");
    expect(invocation.sessionConfig.readOnly).toBe(true);
    expect(invocation.sessionConfig.fileAccessRoots).toHaveLength(2);
    expect(invocation.sessionConfig.fileAccessRoots).toEqual(
      [...invocation.sessionConfig.fileAccessRoots!].sort()
    );
    expect(invocation.startupConfig).toEqual({
      browserMode: "auto",
      browserUrl: "http://127.0.0.1:9333",
      channel: "beta",
      readOnly: true,
      fileAccessRoots: invocation.sessionConfig.fileAccessRoots,
    });
  });

  it("keeps download timeout in tool input", () => {
    const invocation = parseInvocation(["download", "L2", "--timeout", "2500"]);
    expect(buildToolInput(invocation)).toEqual({ id: "L2", timeout: 2500 });
    expect(invocation.startupConfig).toEqual({});
  });

  it("parses explicit global boolean values before the command", () => {
    const invocation = parseInvocation(["--headful", "false", "start"]);
    expect(invocation.command).toBe("start");
    expect(invocation.sessionConfig.headless).toBe(true);
    expect(invocation.startupConfig).toEqual({ headless: true });
  });

  it("rejects global options that have no effect on a command", () => {
    expect(() => parseInvocation(["status", "--headful"])).toThrow(
      "--headful is not valid for status"
    );
    expect(() => parseInvocation(["tools", "--session", "unused"])).toThrow(
      "--session is not valid for tools"
    );
    expect(() => parseInvocation(["get_state", "--quiet"])).toThrow(
      "--quiet is only valid for mcp"
    );
    expect(() => parseInvocation(["help", "--json"])).toThrow(
      "--json is not valid for help"
    );
  });

  it("keeps session and download timeouts separate", () => {
    const invocation = parseInvocation([
      "--timeout",
      "7000",
      "download",
      "L2",
      "--timeout",
      "2500",
    ]);
    expect(invocation.sessionConfig.timeout).toBe(7000);
    expect(buildToolInput(invocation)).toEqual({ id: "L2", timeout: 2500 });
  });

  it("parses output controls", () => {
    const invocation = parseInvocation([
      "screenshot",
      "--element-id",
      "B4",
      "--output",
      "capture.png",
      "--json",
    ]);
    expect(buildToolInput(invocation)).toEqual({ elementId: "B4" });
    expect(invocation.screenshotOutput).toBe("capture.png");
    expect(invocation.json).toBe(true);
  });

  it("rejects malformed numbers, conflicting flags, and unknown options", () => {
    expect(() => parseInvocation(["--port", "9222x", "status"])).toThrow(
      CliUsageError
    );
    expect(() => parseInvocation(["--port", "0", "status"])).toThrow(
      CliUsageError
    );
    expect(() => parseInvocation(["--channel", "", "status"])).toThrow(
      CliUsageError
    );
    for (const flag of ["--browser-url", "--chrome-path", "--user-data-dir"]) {
      expect(() => parseInvocation([flag, "", "status"])).toThrow(CliUsageError);
    }
    expect(() => parseInvocation(["--auto-connect", "--connect-only", "status"])).toThrow(
      CliUsageError
    );
    expect(() => parseInvocation(["status", "--wat"])).toThrow(CliUsageError);
    expect(() =>
      buildToolInput(parseInvocation(["get_state", "--full-page", "--viewport"]))
    ).toThrow("conflicts");
  });

  it("rejects missing and surplus positional arguments", () => {
    expect(() => buildToolInput(parseInvocation(["navigate"]))).toThrow("Missing url");
    expect(() => buildToolInput(parseInvocation(["click", "B1", "B2"]))).toThrow(
      "Unexpected argument"
    );
  });
});

describe("evaluate validation", () => {
  it("limits only shape and size", () => {
    expect(() => validateExpression("document.cookie")).not.toThrow();
    expect(() => validateExpression("fetch('/api')")).not.toThrow();
    expect(() => validateExpression("")).toThrow();
    expect(() => validateExpression("x".repeat(10_001))).toThrow();
  });
});

describe("BrowserController tool preflight", () => {
  it("rejects read-only and unknown calls without acquiring a browser", async () => {
    const controller = new BrowserController({
      browserMode: "launch",
      headless: true,
      readOnly: true,
      allowLocalhost: false,
      allowPrivateHosts: false,
    });
    try {
      await expect(controller.execute("click", { id: "B1" })).resolves.toEqual({
        success: false,
        error: 'Tool "click" is disabled in read-only mode',
      });
      await expect(controller.execute("missing", {})).resolves.toMatchObject({
        success: false,
        error: expect.stringContaining("Unknown tool: missing"),
      });
      expect(controller.status().running).toBe(false);
    } finally {
      await controller.close();
    }
  });

  it("rejects invalid input before acquiring a browser", async () => {
    const controller = new BrowserController({
      browserMode: "launch",
      headless: true,
      readOnly: false,
      allowLocalhost: false,
      allowPrivateHosts: false,
    });
    try {
      await expect(controller.execute("navigate", { url: "not-a-url" })).resolves.toMatchObject({
        success: false,
        error: expect.stringContaining("Invalid URL"),
      });
      await expect(controller.execute("get_state", { maxTokens: -1 })).resolves.toMatchObject({
        success: false,
        error: expect.stringContaining("positive integer"),
      });
      expect(controller.status().running).toBe(false);
    } finally {
      await controller.close();
    }
  });
});

const daemonConfig: SessionConfig = {
  browserMode: "launch",
  headless: true,
  readOnly: false,
  allowLocalhost: false,
  allowPrivateHosts: false,
};

function fakeController(): DaemonController {
  return {
    status: () => ({ running: false }),
    start: async () => ({ running: false }),
    execute: async () => ({ success: true }),
    close: async () => {},
  };
}

function pendingState(
  name: string,
  paths: SessionPaths,
  startupId: string,
  pid = process.pid
): SessionState {
  return {
    protocol: SESSION_PROTOCOL_VERSION,
    version: VERSION,
    session: name,
    secret: "a".repeat(64),
    socketPath: paths.socketPath,
    config: daemonConfig,
    pid,
    ready: false,
    startupId,
  };
}

describe("daemon wire protocol", () => {
  it("surfaces the daemon's oversize-request message instead of a protocol mismatch", async () => {
    const name = `oversize-${randomUUID()}`;
    const paths = getSessionPaths(name);
    writeSessionState(paths, pendingState(name, paths, randomUUID()));
    await runDaemon(paths.stateFile, {
      controllerFactory: fakeController,
      installProcessHandlers: false,
    });
    const ready = readSessionState(paths)!;
    try {
      await expect(
        sendSessionRequest(ready, {
          method: "tool",
          name: "echo",
          input: { blob: "a".repeat(1_100_000) },
        }, 5_000)
      ).rejects.toThrow("Session request exceeded 1 MiB");
    } finally {
      await sendSessionRequest(ready, { method: "stop" }, 2_000).catch(() => undefined);
      removeSessionFiles(paths, true);
    }
  });
});

describe("daemon startup identity", () => {
  it("exits without touching state when the startup token does not match", async () => {
    const name = `token-${randomUUID()}`;
    const paths = getSessionPaths(name);
    const parentPid = 123_456_789;
    writeSessionState(paths, pendingState(name, paths, randomUUID(), parentPid));
    try {
      await expect(
        runDaemon(paths.stateFile, {
          controllerFactory: fakeController,
          installProcessHandlers: false,
          startupToken: randomUUID(),
        })
      ).rejects.toThrow("startup token");
      const state = readSessionState(paths)!;
      expect(state.pid).toBe(parentPid);
      expect(state.ready).toBe(false);
      if (process.platform !== "win32") {
        expect(existsSync(paths.socketPath)).toBe(false);
      }
    } finally {
      removeSessionFiles(paths, true);
    }
  });

  it("does not steal a socket that a live daemon still serves", async () => {
    if (process.platform === "win32") return;
    const name = `probe-${randomUUID()}`;
    const paths = getSessionPaths(name);
    writeSessionState(paths, pendingState(name, paths, randomUUID()));
    await runDaemon(paths.stateFile, {
      controllerFactory: fakeController,
      installProcessHandlers: false,
    });
    const first = readSessionState(paths)!;
    const rivalId = randomUUID();
    writeSessionState(paths, pendingState(name, paths, rivalId));
    try {
      await expect(
        runDaemon(paths.stateFile, {
          controllerFactory: fakeController,
          installProcessHandlers: false,
          startupToken: rivalId,
        })
      ).rejects.toThrow("already served");
      await expect(
        sendSessionRequest<{ pid: number }>(first, { method: "ping" }, 2_000)
      ).resolves.toMatchObject({ pid: process.pid });
    } finally {
      await sendSessionRequest(first, { method: "stop" }, 2_000).catch(() => undefined);
      removeSessionFiles(paths, true);
    }
  });

  it("does not mark ready after the state file changed during startup", async () => {
    const name = `replaced-${randomUUID()}`;
    const paths = getSessionPaths(name);
    const startupId = randomUUID();
    const rivalId = randomUUID();
    writeSessionState(paths, pendingState(name, paths, startupId));
    const controllerFactory = () => {
      writeSessionState(paths, pendingState(name, paths, rivalId));
      return fakeController();
    };
    try {
      await expect(
        runDaemon(paths.stateFile, {
          controllerFactory,
          installProcessHandlers: false,
          startupToken: startupId,
        })
      ).rejects.toThrow("changed during startup");
      const state = readSessionState(paths)!;
      expect(state.ready).toBe(false);
      expect(state.startupId).toBe(rivalId);
    } finally {
      removeSessionFiles(paths, true);
    }
  });
});

describe("daemon argv contract", () => {
  it("round-trips the spawn argv", () => {
    const argv = buildDaemonArgv({ stateFile: "/tmp/x.json", startupToken: "tok" });
    expect(argv[0]).toBe(DAEMON_COMMAND);
    expect(parseDaemonArgv(argv)).toEqual({
      stateFile: "/tmp/x.json",
      startupToken: "tok",
    });
  });

  it("rejects incomplete daemon argv with a protocol error", () => {
    for (const argv of [
      [DAEMON_COMMAND],
      [DAEMON_COMMAND, "--state-file", "/tmp/x.json"],
      [DAEMON_COMMAND, "--startup-token", "tok"],
      [
        DAEMON_COMMAND,
        "--state-file",
        "/tmp/x.json",
        "--startup-token",
        "tok",
        "--startup-token",
        "decoy",
      ],
      [
        DAEMON_COMMAND,
        "--state-file=/tmp/x.json",
        "--startup-token=tok",
      ],
      [
        DAEMON_COMMAND,
        "--startup-token",
        "tok",
        "--state-file",
        "/tmp/x.json",
      ],
    ]) {
      let caught: unknown;
      try {
        parseDaemonArgv(argv);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).name).toBe("SessionProtocolError");
      expect((caught as Error).message).toContain("--startup-token");
    }
  });
});
