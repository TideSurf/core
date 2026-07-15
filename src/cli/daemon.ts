import { createServer, type Server, type Socket } from "node:net";
import { resolve } from "node:path";
import { readFileSync, rmSync } from "node:fs";
import { BrowserController } from "./browser-controller.js";
import {
  SESSION_PROTOCOL_VERSION,
  getSessionPaths,
  removeSessionFiles,
  secretsMatch,
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
  protocol: number;
  id: string;
  secret: string;
  request: SessionRequest;
}

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
    typeof value["secret"] !== "string"
  ) {
    throw new SessionProtocolError("Invalid session request");
  }
  if (value["protocol"] !== SESSION_PROTOCOL_VERSION) {
    throw new SessionProtocolError("Unsupported session protocol version");
  }
  return {
    protocol: value["protocol"],
    id: value["id"],
    secret: value["secret"],
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
}

function errorDetails(error: unknown): { error: string; errorType: string } {
  return {
    error: error instanceof Error ? error.message : String(error),
    errorType: error instanceof Error ? error.name : "Error",
  };
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
  writeSessionState(paths, { ...initial, pid: process.pid, ready: false });

  const controller = options.controllerFactory?.(initial.config) ??
    new BrowserController(initial.config);
  let server!: Server;
  let closing: Promise<void> | null = null;
  let queue: Promise<void> = Promise.resolve();
  let stopping = false;
  const sockets = new Set<Socket>();

  const shutdown = (exitCode = 0): Promise<void> => {
    if (closing) return closing;
    stopping = true;
    closing = (async () => {
      const serverClosed = new Promise<void>((resolveClose) => {
        if (!server.listening) return resolveClose();
        server.close(() => resolveClose());
      });
      for (const socket of sockets) socket.destroy();
      await queue;
      try {
        await controller.close();
      } catch (error) {
        console.error(`[tidesurf] Browser shutdown failed: ${errorDetails(error).error}`);
        exitCode = 1;
      }
      await serverClosed;
      try {
        removeSessionFiles(paths, true);
      } catch {
        removeSessionFiles(paths);
      }
      process.exitCode = exitCode;
    })();
    return closing;
  };

  const handle = async (request: SessionRequest): Promise<unknown> => {
    if (stopping && request.method !== "stop") {
      throw new SessionProtocolError("Session is stopping");
    }
    switch (request.method) {
      case "ping":
        return { pid: process.pid };
      case "status":
        return {
          session: initial.session,
          daemonPid: process.pid,
          version: initial.version,
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
      case "stop":
        stopping = true;
        return { stopped: true, session: initial.session };
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
        if (!secretsMatch(initial.secret, incoming.secret)) {
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
          const data = await handle(authenticated.request);
          if (authenticated.request.method === "stop") {
            send(socket, authenticated.id, { success: true, data }, () => void shutdown(0));
          } else {
            send(socket, authenticated.id, { success: true, data });
          }
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
    socket.on("error", () => {});
  };

  if (process.platform !== "win32") {
    removeStaleSocket(paths.socketPath);
  }
  server = createServer(handleSocket);
  server.on("error", (error) => {
    console.error(`[tidesurf] Session server error: ${error.message}`);
    void shutdown(1);
  });

  try {
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once("error", rejectListen);
      server.listen(paths.socketPath, () => {
        server.removeListener("error", rejectListen);
        resolveListen();
      });
    });
  } catch (error) {
    await controller.close().catch(() => {});
    removeSessionFiles(paths);
    throw error;
  }

  const ready: SessionState = {
    ...initial,
    pid: process.pid,
    ready: true,
    startedAt: new Date().toISOString(),
  };
  writeSessionState(paths, ready);
  rmSync(paths.lockFile, { force: true });

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
  const name = candidate.split(/[\\/]/).pop();
  if (!name?.endsWith(".json")) throw new Error("Invalid session state file");

  // The session name is inside the file, so derive its canonical path after parsing.
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

function removeStaleSocket(socketPath: string): void {
  rmSync(socketPath, { force: true });
}
