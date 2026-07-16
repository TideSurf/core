import { timingSafeEqual } from "node:crypto";
import { connect, createServer, type Server, type Socket } from "node:net";
import { resolve } from "node:path";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { BrowserController } from "./browser-controller.js";
import {
  SESSION_PROTOCOL_VERSION,
  getSessionPaths,
  readSessionState,
  removeSessionFiles,
  writeSessionState,
  SessionProtocolError,
  type SessionRequest,
  type SessionState,
} from "./session.js";
import type { SessionConfig } from "./session.js";
import type { ToolResult } from "../types.js";

const MAX_REQUEST_BYTES = 1024 * 1024;
const REQUEST_IDLE_TIMEOUT_MS = 30_000;

interface IncomingRequest {
  id: string;
  secret: string;
  deadline: number;
  executionTimeout: number;
  request: SessionRequest;
}

type ActiveSessionRequest = Exclude<SessionRequest, { method: "stop" }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSessionRequest(value: unknown): SessionRequest {
  if (!isRecord(value) || typeof value["method"] !== "string") {
    throw new SessionProtocolError("Invalid session request");
  }

  switch (value["method"]) {
    case "ping":
    case "start":
    case "status":
    case "stop":
      return { method: value["method"] };
    case "tool": {
      const name = value["name"];
      const input = value["input"];
      if (typeof name !== "string" || name.length === 0 || !isRecord(input)) {
        throw new SessionProtocolError("Invalid tool request");
      }
      return { method: "tool", name, input };
    }
    default:
      throw new SessionProtocolError("Unknown session request method");
  }
}

function parseIncomingRequest(value: unknown): IncomingRequest {
  if (
    !isRecord(value) ||
    typeof value["protocol"] !== "number" ||
    typeof value["id"] !== "string" ||
    value["id"].length === 0 ||
    typeof value["secret"] !== "string" ||
    !Number.isFinite(value["deadline"]) ||
    !Number.isFinite(value["executionTimeout"]) ||
    (value["executionTimeout"] as number) <= 0
  ) {
    throw new SessionProtocolError("Invalid session request");
  }
  if (value["protocol"] !== SESSION_PROTOCOL_VERSION) {
    throw new SessionProtocolError("Unsupported session protocol version");
  }
  return {
    id: value["id"],
    secret: value["secret"],
    deadline: value["deadline"] as number,
    executionTimeout: value["executionTimeout"] as number,
    request: parseSessionRequest(value["request"]),
  };
}

export interface DaemonController {
  status(): unknown;
  start(): Promise<unknown>;
  execute(name: string, input: Record<string, unknown>): Promise<ToolResult>;
  close(): Promise<void>;
}

export interface RunDaemonOptions {
  controllerFactory?: (config: SessionConfig) => DaemonController;
  installProcessHandlers?: boolean;
  startupToken?: string;
}

function errorDetails(error: unknown): { error: string; errorType: string } {
  return {
    error: error instanceof Error ? error.message : String(error),
    errorType: error instanceof Error ? error.name : "Error",
  };
}

function secretsMatch(expected: Uint8Array, received: string): boolean {
  const value = Buffer.from(received);
  return expected.length === value.length && timingSafeEqual(expected, value);
}

// Anything other than a fast connection error means the endpoint may still
// be served, so err on the side of not stealing it.
function endpointInUse(socketPath: string): Promise<boolean> {
  if (!existsSync(socketPath)) return Promise.resolve(false);
  return new Promise((resolveProbe) => {
    let probe: Socket;
    try {
      probe = connect(socketPath);
    } catch {
      resolveProbe(false);
      return;
    }
    let settled = false;
    const settle = (value: boolean) => {
      if (settled) return;
      settled = true;
      probe.destroy();
      resolveProbe(value);
    };
    probe.setTimeout(500, () => settle(true));
    probe.on("connect", () => settle(true));
    probe.on("error", () => settle(false));
  });
}

function send(
  socket: Socket,
  id: string,
  response: { success: boolean; data?: unknown; error?: string; errorType?: string },
  onFlushed?: () => void
): void {
  if (socket.destroyed) {
    onFlushed?.();
    return;
  }
  socket.end(`${JSON.stringify({
    protocol: SESSION_PROTOCOL_VERSION,
    id,
    ...response,
  })}\n`, onFlushed);
}

export async function runDaemon(
  stateFile: string,
  options: RunDaemonOptions = {}
): Promise<void> {
  const initial = readSessionStateFromFile(stateFile);
  const paths = getSessionPaths(initial.session);
  if (resolve(paths.stateFile) !== resolve(stateFile)) {
    throw new Error("Session state file does not match its session name");
  }
  if (
    options.startupToken !== undefined &&
    initial.startupId !== options.startupToken
  ) {
    throw new SessionProtocolError(
      "Session state file no longer carries this daemon's startup token"
    );
  }
  writeSessionState(paths, { ...initial, pid: process.pid, ready: false });

  const controller = options.controllerFactory
    ? options.controllerFactory(initial.config)
    : new BrowserController(initial.config);
  const expectedSecret = Buffer.from(initial.secret);
  let server!: Server;
  let closing: Promise<void> | null = null;
  let serverClosing: Promise<void> | null = null;
  let resourceCleanup: Promise<Error | undefined> | null = null;
  let queue: Promise<void> = Promise.resolve();
  let stopping = false;
  const sockets = new Set<Socket>();

  const stopListening = (): Promise<void> => {
    if (serverClosing) return serverClosing;
    serverClosing = new Promise<void>((resolveClose) => {
      if (!server.listening) return resolveClose();
      server.close(() => resolveClose());
    });
    return serverClosing;
  };

  const cleanupResources = (): Promise<Error | undefined> => {
    if (resourceCleanup) return resourceCleanup;
    resourceCleanup = (async () => {
      const failures: string[] = [];
      try {
        await controller.close();
      } catch (error) {
        failures.push(`browser shutdown: ${errorDetails(error).error}`);
      }
      if (failures.length === 0) {
        try {
          removeSessionFiles(paths);
        } catch (error) {
          failures.push(`session cleanup: ${errorDetails(error).error}`);
        }
      }
      if (failures.length === 0) {
        try {
          rmSync(paths.logFile, { force: true });
        } catch (error) {
          failures.push(`log cleanup: ${errorDetails(error).error}`);
        }
      }
      if (failures.length === 0) return undefined;
      return new SessionProtocolError(
        `Session shutdown failed (${failures.join("; ")}). Log: ${paths.logFile}`
      );
    })();
    return resourceCleanup;
  };

  const shutdown = (exitCode = 0): Promise<void> => {
    if (closing) return closing;
    stopping = true;
    closing = (async () => {
      const serverClosed = stopListening();
      for (const socket of sockets) socket.destroy();
      await queue;
      const cleanupError = await cleanupResources();
      await serverClosed;
      if (cleanupError) {
        console.error(`[tidesurf] ${cleanupError.message}`);
        exitCode = 1;
      }
      process.exitCode = exitCode;
    })();
    return closing;
  };

  const handle = async (request: ActiveSessionRequest): Promise<unknown> => {
    if (stopping) throw new SessionProtocolError("Session is stopping");
    switch (request.method) {
      case "ping":
        return { pid: process.pid };
      case "status":
        return {
          session: initial.session,
          daemonPid: process.pid,
          version: initial.version,
          running: true,
          starting: false,
          ready: true,
          browser: controller.status(),
          config: initial.config,
        };
      case "start":
        return {
          session: initial.session,
          daemonPid: process.pid,
          version: initial.version,
          browser: await controller.start(),
          config: initial.config,
        };
      case "tool":
        return controller.execute(request.name, request.input);
    }
  };

  const handleSocket = (socket: Socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.setTimeout(REQUEST_IDLE_TIMEOUT_MS, () => socket.destroy());
    socket.setEncoding("utf8");
    const chunks: string[] = [];
    let receivedBytes = 0;
    let handled = false;

    socket.on("data", (chunk: string) => {
      if (handled) return;
      receivedBytes += Buffer.byteLength(chunk);
      if (receivedBytes > MAX_REQUEST_BYTES) {
        handled = true;
        send(socket, "", {
          success: false,
          error: "Session request exceeded 1 MiB",
          errorType: "SessionProtocolError",
        });
        return;
      }
      chunks.push(chunk);
      if (!chunk.includes("\n")) return;
      const body = chunks.join("");
      const newline = body.indexOf("\n");
      handled = true;

      let incoming: IncomingRequest | undefined;
      let requestId = "";
      try {
        const value: unknown = JSON.parse(body.slice(0, newline));
        if (isRecord(value) && typeof value["id"] === "string") {
          requestId = value["id"];
        }
        incoming = parseIncomingRequest(value);
        if (!secretsMatch(expectedSecret, incoming.secret)) {
          throw new SessionProtocolError("Session authentication failed");
        }
      } catch (error) {
        send(socket, incoming?.id ?? requestId, {
          success: false,
          ...errorDetails(error),
        });
        return;
      }

      const authenticated = incoming!;
      socket.setTimeout(0);

      const task = async () => {
        try {
          if (
            authenticated.request.method !== "ping" &&
            authenticated.request.method !== "status"
          ) {
            if (socket.destroyed) return;
            if (
              Date.now() + authenticated.executionTimeout > authenticated.deadline
            ) {
              throw new SessionProtocolError(
                "Session request was cancelled before execution because its queue deadline expired"
              );
            }
          }
          if (authenticated.request.method === "stop") {
            stopping = true;
            void stopListening();
            const cleanupError = await cleanupResources();
            if (cleanupError) {
              send(socket, authenticated.id, {
                success: false,
                ...errorDetails(cleanupError),
              }, () => setTimeout(() => void shutdown(1), 0));
              return;
            }
            send(socket, authenticated.id, {
              success: true,
              data: {
                stopped: true,
                session: initial.session,
              },
            }, () => setTimeout(() => void shutdown(0), 0));
            return;
          }
          const data = await handle(authenticated.request);
          send(socket, authenticated.id, { success: true, data });
        } catch (error) {
          send(socket, authenticated.id, { success: false, ...errorDetails(error) });
        }
      };

      if (
        authenticated.request.method === "ping" ||
        authenticated.request.method === "status"
      ) {
        void task();
      } else {
        queue = queue.then(task, task);
      }
    });
    socket.on("error", () => socket.destroy());
  };

  if (process.platform !== "win32") {
    if (await endpointInUse(paths.socketPath)) {
      try {
        await controller.close();
      } catch (closeError) {
        console.error(`[tidesurf] Browser shutdown failed: ${errorDetails(closeError).error}`);
      }
      throw new SessionProtocolError(
        `Session "${initial.session}" is already served by a live daemon socket`
      );
    }
    rmSync(paths.socketPath, { force: true });
  }
  server = createServer(handleSocket);

  try {
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once("error", rejectListen);
      server.listen(paths.socketPath, () => {
        server.removeListener("error", rejectListen);
        resolveListen();
      });
    });
  } catch (error) {
    try {
      await controller.close();
    } catch (closeError) {
      console.error(`[tidesurf] Browser shutdown failed: ${errorDetails(closeError).error}`);
    }
    // EADDRINUSE means another daemon owns the endpoint; its files are not ours to remove.
    if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") {
      try {
        removeSessionFiles(paths);
      } catch (cleanupError) {
        console.error(`[tidesurf] Session cleanup failed: ${errorDetails(cleanupError).error}`);
      }
    }
    throw error;
  }
  server.on("error", (error) => {
    console.error(`[tidesurf] Session server error: ${error.message}`);
    void shutdown(1);
  });

  // Residual startup race: another startup can replace the state file after
  // this daemon bound the socket. Losing here exits without touching shared
  // files (the next daemon's probe reclaims the stale socket file). Both
  // racers can lose - this daemon on the token, the rival on the socket
  // probe - which fails safe as a startup timeout, not a duplicate daemon.
  const current = readSessionState(paths);
  if (
    !current ||
    current.startupId !== initial.startupId ||
    current.pid !== process.pid
  ) {
    for (const socket of sockets) socket.destroy();
    await stopListening();
    try {
      await controller.close();
    } catch (closeError) {
      console.error(`[tidesurf] Browser shutdown failed: ${errorDetails(closeError).error}`);
    }
    throw new SessionProtocolError("Session state file changed during startup");
  }

  const ready: SessionState = {
    ...initial,
    pid: process.pid,
    ready: true,
    startedAt: new Date().toISOString(),
  };
  try {
    writeSessionState(paths, ready);
    rmSync(paths.lockFile, { force: true });
  } catch (error) {
    await shutdown(1);
    throw error;
  }

  if (options.installProcessHandlers !== false) {
    process.once("SIGINT", () => void shutdown(130));
    process.once("SIGTERM", () => void shutdown(143));
    process.once("SIGHUP", () => void shutdown(0));
    process.once("uncaughtException", (error) => {
      console.error(`[tidesurf] Uncaught daemon error: ${errorDetails(error).error}`);
      void shutdown(1);
    });
    process.once("unhandledRejection", (error) => {
      console.error(`[tidesurf] Unhandled daemon rejection: ${errorDetails(error).error}`);
      void shutdown(1);
    });
  }
}

function readSessionStateFromFile(stateFile: string): SessionState {
  const candidate = resolve(stateFile);
  const raw = JSON.parse(readFileSync(candidate, "utf8")) as SessionState;
  if (
    raw.protocol !== SESSION_PROTOCOL_VERSION ||
    raw.ready ||
    !Number.isInteger(raw.pid) ||
    raw.pid <= 0 ||
    typeof raw.session !== "string" ||
    typeof raw.secret !== "string" ||
    typeof raw.startupId !== "string" ||
    !raw.config
  ) {
    throw new Error("Invalid pending session state");
  }
  return raw;
}
