import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TideSurf } from "../../src/tidesurf.js";
import {
  isOwnedBrowserEndpoint,
  verifyOwnedBrowserEndpoint,
} from "../../src/cdp/launcher.js";

// A fake Chrome that answers HTTP DevTools discovery but destroys every
// websocket upgrade, so launchChrome succeeds and the later CDP connect
// fails, driving the TideSurf.launch rollback path deterministically.
const FAKE_CHROME_SCRIPT = `#!/usr/bin/env bun
const http = require("http");
const fs = require("fs");
const path = require("path");
const dirArg = process.argv.find((arg) => arg.startsWith("--user-data-dir="));
const userDataDir = dirArg ? dirArg.slice("--user-data-dir=".length) : undefined;
const server = http.createServer((req, res) => {
  const port = server.address().port;
  if (req.url === "/json/version") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      Browser: "FakeChrome/1.0",
      webSocketDebuggerUrl: "ws://127.0.0.1:" + port + "/devtools/browser/fake",
    }));
    return;
  }
  if (req.url === "/json/list" || req.url === "/json") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify([{
      id: "tab1",
      type: "page",
      title: "Fake",
      url: "about:blank",
      webSocketDebuggerUrl: "ws://127.0.0.1:" + port + "/devtools/page/tab1",
    }]));
    return;
  }
  res.writeHead(404);
  res.end();
});
server.on("upgrade", (socket) => socket.destroy());
server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  if (userDataDir) {
    fs.writeFileSync(
      path.join(userDataDir, "DevToolsActivePort"),
      port + "\\n/devtools/browser/fake"
    );
  }
  if (process.env.FAKE_CHROME_PORT_FILE) {
    fs.writeFileSync(process.env.FAKE_CHROME_PORT_FILE, String(port));
  }
  if (process.env.FAKE_CHROME_PID_FILE) {
    fs.writeFileSync(process.env.FAKE_CHROME_PID_FILE, String(process.pid));
  }
});
process.on("SIGTERM", () => process.exit(0));
setInterval(() => {}, 1000);
`;

const ENV_KEYS = ["FAKE_CHROME_PORT_FILE", "FAKE_CHROME_PID_FILE"] as const;

let fixtureDir: string;
let portFile: string;
let pidFile: string;
let savedEnv: Record<string, string | undefined>;

function readNumberFile(path: string): number {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (existsSync(path)) {
      const value = Number(readFileSync(path, "utf8").trim());
      if (Number.isInteger(value) && value > 0) return value;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
  throw new Error(`fake Chrome did not write ${path}`);
}

beforeAll(() => {
  fixtureDir = mkdtempSync(join(tmpdir(), "tidesurf-launch-rollback-"));
  const script = join(fixtureDir, "fake-chrome");
  writeFileSync(script, FAKE_CHROME_SCRIPT, { mode: 0o755 });
  chmodSync(script, 0o755);
  portFile = join(fixtureDir, "fake-port");
  pidFile = join(fixtureDir, "fake-pid");
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env["FAKE_CHROME_PORT_FILE"] = portFile;
  process.env["FAKE_CHROME_PID_FILE"] = pidFile;
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  rmSync(fixtureDir, { recursive: true, force: true });
});

describe("launch rollback", () => {
  it("releases the owned-endpoint claim and orphan record when connect fails", async () => {
    await expect(
      TideSurf.launch({
        chromePath: join(fixtureDir, "fake-chrome"),
        timeout: 10_000,
      })
    ).rejects.toThrow();

    const port = readNumberFile(portFile);
    expect(isOwnedBrowserEndpoint("127.0.0.1", port)).toBe(false);
    expect(await verifyOwnedBrowserEndpoint("127.0.0.1", port)).toBe(false);

    const chromePid = readNumberFile(pidFile);
    const orphanRecord = join(
      tmpdir(),
      "tidesurf-orphans",
      `${process.pid}-${chromePid}.json`
    );
    expect(existsSync(orphanRecord)).toBe(false);
  }, 30_000);
});
