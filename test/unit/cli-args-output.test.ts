import { describe, expect, it } from "bun:test";
import { createServer } from "node:net";
import { join } from "node:path";
import {
  CliUsageError,
  jsonOutputRequested,
  parseInvocation,
} from "../../src/cli/args.js";
import { commandHelp, generalHelp } from "../../src/cli/help.js";
import { CLI_ERROR_EXIT_CODES } from "../../src/cli/metadata.js";
import {
  SESSION_PROTOCOL_VERSION,
  SessionProtocolError,
  SessionStateError,
  getSessionPaths,
  removeSessionFiles,
  writeSessionState,
  type SessionConfig,
  type SessionPaths,
} from "../../src/cli/session.js";
import {
  ActionCommittedError,
  CDPConnectionError,
  CDPTimeoutError,
  ChromeLaunchError,
  ElementNotFoundError,
  NavigationError,
  ReadOnlyError,
  TideSurfError,
  ValidationError,
} from "../../src/errors.js";
import { VERSION } from "../../src/version.js";

const root = join(import.meta.dir, "..", "..");

function cli(...args: string[]) {
  const result = Bun.spawnSync({
    cmd: [process.execPath, join(root, "src", "cli.ts"), ...args],
    cwd: root,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

async function cliAsync(...args: string[]) {
  const child = Bun.spawn({
    cmd: [process.execPath, join(root, "src", "cli.ts"), ...args],
    cwd: root,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, stdout, stderr };
}

const BASE_CONFIG: SessionConfig = {
  browserMode: "launch",
  headless: true,
  readOnly: false,
  allowLocalhost: false,
  allowPrivateHosts: false,
};

function writeRunningState(session: string, timeout: number): SessionPaths {
  const paths = getSessionPaths(session);
  writeSessionState(paths, {
    protocol: SESSION_PROTOCOL_VERSION,
    version: VERSION,
    session,
    secret: "a".repeat(64),
    socketPath: paths.socketPath,
    config: { ...BASE_CONFIG, timeout },
    pid: process.pid,
    ready: true,
    startupId: crypto.randomUUID(),
  });
  return paths;
}

describe("request budget from the daemon config", () => {
  it("uses the running daemon's timeout for the stop budget", () => {
    const session = `budget-stop-${crypto.randomUUID()}`;
    const paths = writeRunningState(session, 200_000_000);
    try {
      const result = cli("--session", session, "stop");
      expect(result.code).toBe(2);
      expect(result.stderr).toContain("session transport limit");
    } finally {
      removeSessionFiles(paths, true);
    }
  });

  it("uses the running daemon's timeout for tool budgets, not local defaults", async () => {
    const session = `budget-tool-${crypto.randomUUID()}`;
    const paths = writeRunningState(session, 200_000_000);
    const server = createServer((socket) => {
      socket.setEncoding("utf8");
      let buffer = "";
      socket.on("data", (chunk: string) => {
        buffer += chunk;
        const newline = buffer.indexOf("\n");
        if (newline === -1) return;
        const request = JSON.parse(buffer.slice(0, newline)) as { id: string };
        socket.end(`${JSON.stringify({
          protocol: SESSION_PROTOCOL_VERSION,
          id: request.id,
          success: true,
          data: {},
        })}\n`);
      });
    });
    await new Promise<void>((resolveListen) =>
      server.listen(paths.socketPath, resolveListen)
    );
    try {
      const result = await cliAsync("--session", session, "get_state");
      expect(result.code).toBe(2);
      expect(result.stderr).toContain("session transport limit");
    } finally {
      await new Promise((resolveClose) => server.close(resolveClose));
      removeSessionFiles(paths, true);
    }
  });
});

describe("jsonOutputRequested", () => {
  it("matches the real parse when a string option consumes --json", () => {
    expect(jsonOutputRequested(["get_state", "--mode", "--json"])).toBe(false);
    expect(jsonOutputRequested(["get_state", "--mode=interactive", "--json"])).toBe(true);
  });

  it("reads global json flags", () => {
    expect(jsonOutputRequested(["--json", "status"])).toBe(true);
    expect(jsonOutputRequested(["status", "--json"])).toBe(true);
    expect(jsonOutputRequested(["status"])).toBe(false);
  });

  it("falls back tolerantly when the parse fails", () => {
    expect(jsonOutputRequested(["--json", "not-a-command"])).toBe(true);
    expect(jsonOutputRequested(["--json", "false", "not-a-command"])).toBe(false);
    expect(jsonOutputRequested(["--json=false", "not-a-command"])).toBe(false);
    expect(jsonOutputRequested(["--no-json", "not-a-command"])).toBe(false);
    expect(jsonOutputRequested(["--no-json=false", "not-a-command"])).toBe(true);
    expect(jsonOutputRequested(["--session", "--json", "not-a-command"])).toBe(false);
  });

  it("prints a text error when --json was consumed as an option value", () => {
    const session = `json-scan-${crypto.randomUUID()}`;
    const result = cli("--session", session, "get_state", "--mode", "--json");
    expect(result.code).toBe(2);
    expect(result.stderr).toStartWith("tidesurf: ");
    expect(result.stderr).toContain("must be one of");
    expect(result.stderr).toContain("Run 'tidesurf help' for usage.");
  });
});

describe("error exit code table", () => {
  const cases: ReadonlyArray<[Error, number]> = [
    [new CliUsageError("x"), 2],
    [new ChromeLaunchError("x"), 3],
    [new CDPConnectionError("x"), 3],
    [new NavigationError("https://example.com"), 3],
    [new SessionStateError("x"), 3],
    [new SessionProtocolError("x"), 5],
    [new TideSurfError("x"), 4],
    [new CDPTimeoutError("op", 10), 4],
    [new ElementNotFoundError("B1"), 4],
    [new ValidationError("x"), 4],
    [new ReadOnlyError("op"), 4],
    [new ActionCommittedError("op", new Error("cause")), 4],
  ];

  it("maps every first-party error name to its documented exit code", () => {
    for (const [error, code] of cases) {
      expect(CLI_ERROR_EXIT_CODES[error.name]).toBe(code);
    }
    expect(Object.keys(CLI_ERROR_EXIT_CODES).sort()).toEqual(
      cases.map(([error]) => error.name).sort()
    );
  });

  it("leaves unknown names to the conservative tool fallback", () => {
    expect(CLI_ERROR_EXIT_CODES["Error"]).toBeUndefined();
    expect(CLI_ERROR_EXIT_CODES["UnknownError"]).toBeUndefined();
  });
});

describe("shared option validation", () => {
  it("validates ports through validatePort", () => {
    expect(() => parseInvocation(["--port", "70000", "status"])).toThrow(CliUsageError);
    expect(() => parseInvocation(["--port", "70000", "status"])).toThrow(
      "between 1 and 65535"
    );
    expect(parseInvocation(["--port", "9222", "start"]).sessionConfig.port).toBe(9222);
  });

  it("caps session and tool timeouts at the timer limit", () => {
    expect(() => parseInvocation(["--timeout", "0", "start"])).toThrow(
      "--timeout must be a positive integer"
    );
    expect(() => parseInvocation(["--timeout", "2.5", "start"])).toThrow(CliUsageError);
    expect(() => parseInvocation(["--timeout", "3000000000", "start"])).toThrow(
      "--timeout must not exceed 2147483647"
    );
    expect(() =>
      parseInvocation(["download", "L2", "--timeout", "3000000000"])
    ).toThrow("--timeout must not exceed 2147483647");
    expect(
      parseInvocation(["--timeout", "120000", "start"]).sessionConfig.timeout
    ).toBe(120000);
  });
});

describe("single-pass parsing", () => {
  it("keeps unknown-command precedence over pre-command value errors", () => {
    expect(() => parseInvocation(["--port", "9x", "wat"])).toThrow("Unknown command: wat");
    expect(() => parseInvocation(["--wat", "wat2"])).toThrow("Unknown option: --wat");
    expect(() => parseInvocation(["--port", "9x", "status", "--wat"])).toThrow(
      "finite number"
    );
  });

  it("resolves the command after the double dash", () => {
    const invocation = parseInvocation(["--", "get_state", "--json"]);
    expect(invocation.command).toBe("get_state");
    expect(invocation.positionals).toEqual(["--json"]);
    expect(invocation.json).toBe(false);
  });

  it("consumes explicit boolean values while finding the command", () => {
    const invocation = parseInvocation(["--headful", "false", "start"]);
    expect(invocation.command).toBe("start");
    expect(invocation.sessionConfig.headless).toBe(true);
  });

  it("keeps local options scoped to their command position", () => {
    const invocation = parseInvocation([
      "--timeout",
      "7000",
      "download",
      "L2",
      "--timeout",
      "2500",
    ]);
    expect(invocation.sessionConfig.timeout).toBe(7000);
    expect(invocation.values["timeout"]).toBe(2500);
  });
});

describe("help and success output", () => {
  it("builds general and command help directly", () => {
    expect(generalHelp()).toContain("Global options:");
    expect(generalHelp()).toBe(generalHelp());
    expect(commandHelp("navigate")).toContain("tidesurf navigate <url>");
    expect(commandHelp("start")).toStartWith("Usage: tidesurf start");
    expect(commandHelp("wat")).toBeUndefined();
  });

  it("prints the text and json success shapes for lifecycle output", () => {
    const session = `fmt-${crypto.randomUUID()}`;
    const text = cli("--session", session, "status");
    expect(text.code).toBe(0);
    expect(text.stdout.trim()).toBe(`Session ${session} is stopped.`);
    const json = cli("--session", session, "status", "--json");
    expect(json.code).toBe(0);
    expect(JSON.parse(json.stdout)).toEqual({
      success: true,
      data: { session, running: false },
    });
  });
});
