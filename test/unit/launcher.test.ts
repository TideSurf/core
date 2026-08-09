import {
  buildChromeArgs,
  discoverActiveBrowser,
  discoverBrowser,
  getChromeExecutableSearchPaths,
  isOwnedBrowserEndpoint,
  launchChrome,
  parseDevToolsActivePort,
  releaseOwnedBrowserEndpoint,
  readDevToolsActivePort,
  resolveChromeExecutable,
  terminateChromeProcess,
  unregisterOrphanedBrowser,
  verifyOwnedBrowserEndpoint,
} from "../../src/cdp/launcher.js";
import type { ChildProcess } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CDPConnectionError, ChromeLaunchError } from "../../src/errors.js";
import type { CDPConnection } from "../../src/cdp/connection.js";
import { SurfingPage } from "../../src/cdp/page.js";
import type { TabManager } from "../../src/cdp/tab-manager.js";
import { TideSurf } from "../../src/tidesurf.js";

async function listen(server: Server, host?: string): Promise<number> {
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    const onListen = () => {
      server.removeListener("error", rejectListen);
      resolveListen();
    };
    if (host) server.listen(0, host, onListen);
    else server.listen(0, onListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server did not bind to TCP");
  return address.port;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose());
  });
}

function createDevToolsServer(
  browserPath: string,
  targets: readonly Record<string, unknown>[]
): Server {
  return createServer((request, response) => {
    let body: unknown;
    if (request.url === "/json/version") {
      body = {
        webSocketDebuggerUrl: `ws://${request.headers.host ?? "localhost"}${browserPath}`,
      };
    } else if (request.url === "/json/list") {
      body = targets;
    } else {
      response.writeHead(404, { connection: "close" });
      response.end();
      return;
    }
    response.writeHead(200, {
      "content-type": "application/json",
      connection: "close",
    });
    response.end(JSON.stringify(body));
  });
}

describe("buildChromeArgs", () => {
  it("keeps the Chrome sandbox in ordinary CI environments", () => {
    const args = buildChromeArgs(
      {
        headless: true,
        port: 9222,
        userDataDir: "/tmp/tidesurf-profile",
      },
      { CI: "true" },
      1000
    );

    expect(args).not.toContain("--no-sandbox");
    expect(args).not.toContain("--disable-setuid-sandbox");
  });

  it("disables the sandbox when explicitly requested", () => {
    const args = buildChromeArgs(
      {
        headless: true,
        port: 9222,
        userDataDir: "/tmp/tidesurf-profile",
      },
      { TIDESURF_NO_SANDBOX: "1" },
      1000
    );

    expect(args).toContain("--no-sandbox");
    expect(args).toContain("--disable-setuid-sandbox");
  });

  it("disables the sandbox when running as root", () => {
    const args = buildChromeArgs(
      {
        headless: false,
        port: 9222,
        userDataDir: "/tmp/tidesurf-profile",
      },
      {},
      0
    );

    expect(args).toContain("--no-sandbox");
    expect(args).not.toContain("--headless=new");
  });

  it("uses an ephemeral debugging port when requested", () => {
    const args = buildChromeArgs({
      headless: true,
      port: 0,
      userDataDir: "/tmp/tidesurf-profile",
    });
    expect(args).toContain("--remote-debugging-port=0");
  });
});

describe("Chrome executable resolution", () => {
  it("honors an explicit executable before environment and PATH", () => {
    const root = mkdtempSync(join(tmpdir(), "tidesurf-resolver-"));
    const suffix = process.platform === "win32" ? ".exe" : "";
    const explicit = join(root, `explicit-chrome${suffix}`);
    const fromEnv = join(root, `env-chrome${suffix}`);
    writeFileSync(explicit, "#!/bin/sh\n");
    writeFileSync(fromEnv, "#!/bin/sh\n");
    chmodSync(explicit, 0o755);
    chmodSync(fromEnv, 0o755);
    try {
      expect(
        resolveChromeExecutable({ chromePath: explicit, env: { CHROME_PATH: fromEnv } })
      ).toBe(explicit);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolves only the requested channel from PATH", () => {
    const root = mkdtempSync(join(tmpdir(), "tidesurf-channel-"));
    const channel = process.platform === "win32" ? "chromium" : "beta";
    const name = process.platform === "win32" ? "chromium.exe" : "google-chrome-beta";
    const executable = join(root, name);
    writeFileSync(executable, "#!/bin/sh\n");
    chmodSync(executable, 0o755);
    try {
      expect(
        resolveChromeExecutable({
          channel,
          env: { PATH: root, HOME: root },
        })
      ).toBe(executable);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("honors CHROME_PATH before PATH", () => {
    const root = mkdtempSync(join(tmpdir(), "tidesurf-env-resolver-"));
    const suffix = process.platform === "win32" ? ".exe" : "";
    const fromEnv = join(root, `env-chrome${suffix}`);
    const pathDir = join(root, "path");
    const pathName = process.platform === "win32" ? "chrome.exe" : "google-chrome";
    const fromPath = join(pathDir, pathName);
    mkdirSync(pathDir);
    writeFileSync(fromEnv, "executable");
    writeFileSync(fromPath, "executable");
    chmodSync(fromEnv, 0o755);
    chmodSync(fromPath, 0o755);
    try {
      expect(
        resolveChromeExecutable({
          env: { CHROME_PATH: fromEnv, PATH: pathDir, HOME: root },
        })
      ).toBe(fromEnv);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("orders PATH before platform installs on macOS", () => {
    expect(
      getChromeExecutableSearchPaths({
        channel: "stable",
        platform: "darwin",
        env: { PATH: "/opt/one:/opt/two", HOME: "/Users/tidesurf" },
      })
    ).toEqual([
      "/opt/one/google-chrome",
      "/opt/one/chrome",
      "/opt/two/google-chrome",
      "/opt/two/chrome",
      "/Users/tidesurf/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ]);
  });

  it("orders PATH before platform installs on Linux", () => {
    expect(
      getChromeExecutableSearchPaths({
        channel: "stable",
        platform: "linux",
        env: { PATH: "/opt/one:/opt/two", HOME: "/home/tidesurf" },
      })
    ).toEqual([
      "/opt/one/google-chrome",
      "/opt/one/google-chrome-stable",
      "/opt/two/google-chrome",
      "/opt/two/google-chrome-stable",
      "/usr/bin/google-chrome",
      "/usr/local/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/local/bin/google-chrome-stable",
    ]);
  });

  it("orders LOCALAPPDATA before Windows machine installs", () => {
    expect(
      getChromeExecutableSearchPaths({
        channel: "stable",
        platform: "win32",
        env: {
          PATH: "C:\\Tools;D:\\Bins",
          USERPROFILE: "C:\\Users\\TideSurf",
          LOCALAPPDATA: "C:\\Users\\TideSurf\\AppData\\Local",
          PROGRAMFILES: "C:\\Program Files",
          "PROGRAMFILES(X86)": "C:\\Program Files (x86)",
        },
      })
    ).toEqual([
      "C:\\Tools\\chrome.exe",
      "D:\\Bins\\chrome.exe",
      "C:\\Users\\TideSurf\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    ]);
  });

  it("does not treat an ambiguous Windows PATH chrome as a requested channel", () => {
    expect(
      getChromeExecutableSearchPaths({
        channel: "beta",
        platform: "win32",
        env: {
          PATH: "C:\\Tools",
          LOCALAPPDATA: "C:\\Users\\TideSurf\\AppData\\Local",
          PROGRAMFILES: "C:\\Program Files",
          "PROGRAMFILES(X86)": "C:\\Program Files (x86)",
        },
      })
    ).toEqual([
      "C:\\Users\\TideSurf\\AppData\\Local\\Google\\Chrome Beta\\Application\\chrome.exe",
      "C:\\Program Files\\Google\\Chrome Beta\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome Beta\\Application\\chrome.exe",
    ]);
  });

  it("keeps every PATH channel ahead of platform installation fallback", () => {
    const candidates = getChromeExecutableSearchPaths({
      platform: "linux",
      env: { PATH: "/agent/bin", HOME: "/home/tidesurf" },
    });
    expect(candidates.indexOf("/agent/bin/google-chrome")).toBeLessThan(
      candidates.indexOf("/agent/bin/google-chrome-beta")
    );
    expect(candidates.indexOf("/agent/bin/google-chrome-beta")).toBeLessThan(
      candidates.indexOf("/agent/bin/google-chrome-unstable")
    );
    expect(candidates.indexOf("/agent/bin/google-chrome-canary")).toBeLessThan(
      candidates.indexOf("/agent/bin/chromium")
    );
    expect(candidates.indexOf("/agent/bin/chromium-browser")).toBeLessThan(
      candidates.indexOf("/usr/bin/google-chrome")
    );
  });

  it("rejects directories and non-executable files", () => {
    const root = mkdtempSync(join(tmpdir(), "tidesurf-invalid-"));
    const file = join(root, "chrome");
    mkdirSync(join(root, "directory"));
    writeFileSync(file, "not executable");
    try {
      expect(() => resolveChromeExecutable({ chromePath: join(root, "directory") })).toThrow(
        ChromeLaunchError
      );
      expect(() => resolveChromeExecutable({ chromePath: file })).toThrow(
        ChromeLaunchError
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("DevToolsActivePort", () => {
  it("parses the real port and browser endpoint", () => {
    expect(parseDevToolsActivePort("43125\n/devtools/browser/abc-123\n")).toEqual({
      port: 43125,
      browserPath: "/devtools/browser/abc-123",
    });
  });

  it("rejects malformed marker files", () => {
    expect(() => parseDevToolsActivePort("not-a-port\n/devtools/browser/id")).toThrow(
      ChromeLaunchError
    );
    expect(() => parseDevToolsActivePort("9222\n/not-devtools/id")).toThrow(
      ChromeLaunchError
    );
  });

  it("reads a marker from a profile and returns null when absent", () => {
    const profile = mkdtempSync(join(tmpdir(), "tidesurf-profile-"));
    try {
      expect(readDevToolsActivePort(profile)).toBeNull();
      writeFileSync(
        join(profile, "DevToolsActivePort"),
        "51234\n/devtools/browser/browser-id\n"
      );
      expect(readDevToolsActivePort(profile)?.port).toBe(51234);
    } finally {
      rmSync(profile, { recursive: true, force: true });
    }
  });
});

describe("CDP discovery", () => {
  it("selects a page target from a fixed endpoint", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, {
        "content-type": "application/json",
        connection: "close",
      });
      response.end(JSON.stringify([
        { id: "worker-1", type: "worker" },
        { id: "page-1", type: "page" },
      ]));
    });
    const port = await listen(server, "127.0.0.1");
    try {
      await expect(
        discoverBrowser({ host: "127.0.0.1", port, timeout: 500 })
      ).resolves.toEqual({ host: "127.0.0.1", port, targetId: "page-1" });
    } finally {
      await closeServer(server);
    }
  });

  it("reports an endpoint that has no page target", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, {
        "content-type": "application/json",
        connection: "close",
      });
      response.end(JSON.stringify([{ id: "worker-1", type: "worker" }]));
    });
    const port = await listen(server, "127.0.0.1");
    try {
      await expect(
        discoverBrowser({ host: "127.0.0.1", port, timeout: 500 })
      ).rejects.toThrow("has no page target");
    } finally {
      await closeServer(server);
    }
  });

  it("discovers an active profile through DevToolsActivePort", async () => {
    const server = createDevToolsServer("/devtools/browser/profile-browser", [
      { id: "profile-page", type: "page" },
    ]);
    const port = await listen(server, "127.0.0.1");
    const profile = mkdtempSync(join(tmpdir(), "tidesurf-active-profile-"));
    writeFileSync(
      join(profile, "DevToolsActivePort"),
      `${port}\n/devtools/browser/profile-browser\n`
    );
    try {
      await expect(
        discoverActiveBrowser({ userDataDir: profile, timeout: 500 })
      ).resolves.toEqual({ host: "127.0.0.1", port, targetId: "profile-page" });
    } finally {
      await closeServer(server);
      rmSync(profile, { recursive: true, force: true });
    }
  });

  it("rejects an active marker that points to a different browser", async () => {
    const server = createDevToolsServer("/devtools/browser/current-browser", [
      { id: "other-page", type: "page" },
    ]);
    const port = await listen(server, "127.0.0.1");
    const profile = mkdtempSync(join(tmpdir(), "tidesurf-stale-profile-"));
    writeFileSync(
      join(profile, "DevToolsActivePort"),
      `${port}\n/devtools/browser/stale-browser\n`
    );
    try {
      let failure: unknown;
      try {
        await discoverActiveBrowser({ userDataDir: profile, timeout: 500 });
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(CDPConnectionError);
      expect((failure as Error & { cause?: Error }).cause?.message).toContain(
        "does not match"
      );
    } finally {
      await closeServer(server);
      rmSync(profile, { recursive: true, force: true });
    }
  });

  it("rejects a malformed active-profile marker", async () => {
    const profile = mkdtempSync(join(tmpdir(), "tidesurf-bad-profile-"));
    writeFileSync(
      join(profile, "DevToolsActivePort"),
      "not-a-port\n/devtools/browser/profile-browser\n"
    );
    try {
      await expect(
        discoverActiveBrowser({ userDataDir: profile, timeout: 500 })
      ).rejects.toBeInstanceOf(CDPConnectionError);
    } finally {
      rmSync(profile, { recursive: true, force: true });
    }
  });
});

describe("managed launch failures", () => {
  it("wraps profile setup failures as Chrome launch errors", async () => {
    const root = mkdtempSync(join(tmpdir(), "tidesurf-profile-setup-"));
    const fakeChrome = join(
      root,
      process.platform === "win32" ? "chrome.exe" : "chrome"
    );
    const blocker = join(root, "not-a-directory");
    writeFileSync(fakeChrome, "unused", { mode: 0o755 });
    writeFileSync(blocker, "file");
    chmodSync(fakeChrome, 0o755);

    try {
      await expect(
        launchChrome({
          chromePath: fakeChrome,
          userDataDir: join(blocker, "profile"),
        })
      ).rejects.toBeInstanceOf(ChromeLaunchError);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("includes bounded Chrome stderr when startup exits", async () => {
    if (process.platform === "win32") return;
    const root = mkdtempSync(join(tmpdir(), "tidesurf-launch-stderr-"));
    const fakeChrome = join(root, "chrome");
    writeFileSync(
      fakeChrome,
      "#!/bin/sh\necho 'missing browser dependency' >&2\nexit 9\n",
      { mode: 0o755 }
    );
    chmodSync(fakeChrome, 0o755);

    try {
      await expect(
        launchChrome({ chromePath: fakeChrome, timeout: 1_000 })
      ).rejects.toThrow("Chrome stderr:\nmissing browser dependency");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps an active profile marker when the endpoint has no page target", async () => {
    const server = createDevToolsServer("/devtools/browser/active", []);
    const port = await listen(server, "127.0.0.1");
    const root = mkdtempSync(join(tmpdir(), "tidesurf-active-empty-profile-"));
    const profile = join(root, "profile");
    const sentinel = join(root, "launched");
    const fakeChrome = join(
      root,
      process.platform === "win32" ? "chrome.exe" : "chrome"
    );
    mkdirSync(profile);
    writeFileSync(
      join(profile, "DevToolsActivePort"),
      `${port}\n/devtools/browser/active\n`
    );
    writeFileSync(fakeChrome, `#!/bin/sh\ntouch ${JSON.stringify(sentinel)}\n`, {
      mode: 0o755,
    });
    chmodSync(fakeChrome, 0o755);

    try {
      await expect(
        launchChrome({ chromePath: fakeChrome, userDataDir: profile })
      ).rejects.toThrow("profile is already active");
      expect(existsSync(sentinel)).toBe(false);
      expect(existsSync(join(profile, "DevToolsActivePort"))).toBe(true);
    } finally {
      await closeServer(server);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps a profile marker when its endpoint fails non-connectivity checks", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(503, { "content-type": "text/plain" });
      response.end("unavailable");
    });
    const port = await listen(server, "127.0.0.1");
    const root = mkdtempSync(join(tmpdir(), "tidesurf-unverified-profile-"));
    const profile = join(root, "profile");
    const sentinel = join(root, "launched");
    const fakeChrome = join(
      root,
      process.platform === "win32" ? "chrome.exe" : "chrome"
    );
    mkdirSync(profile);
    writeFileSync(
      join(profile, "DevToolsActivePort"),
      `${port}\n/devtools/browser/unverified\n`
    );
    writeFileSync(fakeChrome, `#!/bin/sh\ntouch ${JSON.stringify(sentinel)}\n`, {
      mode: 0o755,
    });
    chmodSync(fakeChrome, 0o755);

    try {
      await expect(
        launchChrome({ chromePath: fakeChrome, userDataDir: profile })
      ).rejects.toThrow("Could not verify whether the Chrome profile is active");
      expect(existsSync(sentinel)).toBe(false);
      expect(existsSync(join(profile, "DevToolsActivePort"))).toBe(true);
    } finally {
      await closeServer(server);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("retries a transiently partial marker written by a starting browser", async () => {
    if (process.platform === "win32") return;
    const server = createDevToolsServer("/devtools/browser/started", [
      { id: "started-page", type: "page" },
    ]);
    const port = await listen(server, "127.0.0.1");
    const root = mkdtempSync(join(tmpdir(), "tidesurf-transient-marker-"));
    const profile = join(root, "profile");
    const fakeChrome = join(root, "fake-chrome");
    writeFileSync(
      fakeChrome,
      `#!/usr/bin/env node
const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const prefix = "--user-data-dir=";
const argument = process.argv.find((value) => value.startsWith(prefix));
if (!argument) process.exit(2);
const profile = argument.slice(prefix.length);
mkdirSync(profile, { recursive: true });
const marker = join(profile, "DevToolsActivePort");
writeFileSync(marker, "partial\\n");
setTimeout(() => writeFileSync(marker, ${JSON.stringify(
        `${port}\n/devtools/browser/started\n`
      )}), 100);
setInterval(() => {}, 1000);
`,
      { mode: 0o755 }
    );
    chmodSync(fakeChrome, 0o755);

    let launched: Awaited<ReturnType<typeof launchChrome>> | undefined;
    try {
      launched = await launchChrome({
        chromePath: fakeChrome,
        userDataDir: profile,
        timeout: 8_000,
      });
      expect(launched).toMatchObject({ port, targetId: "started-page" });
    } finally {
      if (launched) await terminateChromeProcess(launched.process, 500);
      await closeServer(server);
      rmSync(root, { recursive: true, force: true });
    }
  }, 20_000);

  it("retains owned endpoint and orphan bookkeeping when close cannot terminate", async () => {
    if (process.platform === "win32") return;
    const server = createDevToolsServer("/devtools/browser/owned", [
      { id: "owned-page", type: "page" },
    ]);
    const port = await listen(server, "127.0.0.1");
    const root = mkdtempSync(join(tmpdir(), "tidesurf-owned-endpoint-"));
    const profile = join(root, "profile");
    const fakeChrome = join(root, "fake-chrome");
    writeFileSync(
      fakeChrome,
      `#!/usr/bin/env node
const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const prefix = "--user-data-dir=";
const argument = process.argv.find((value) => value.startsWith(prefix));
if (!argument) process.exit(2);
const profile = argument.slice(prefix.length);
mkdirSync(profile, { recursive: true });
writeFileSync(join(profile, "DevToolsActivePort"), ${JSON.stringify(
        `${port}\n/devtools/browser/owned\n`
      )});
setInterval(() => {}, 1000);
`,
      { mode: 0o755 }
    );
    chmodSync(fakeChrome, 0o755);

    expect(isOwnedBrowserEndpoint("127.0.0.1", port)).toBe(false);
    let launched: Awaited<ReturnType<typeof launchChrome>> | undefined;
    let surf: TideSurf | undefined;
    let originalKill: ChildProcess["kill"] | undefined;
    try {
      launched = await launchChrome({
        chromePath: fakeChrome,
        userDataDir: profile,
        timeout: 8_000,
      });
      expect(launched.port).toBe(port);
      expect(isOwnedBrowserEndpoint(launched.host, launched.port)).toBe(true);
      if (typeof launched.process.pid !== "number") {
        throw new Error("fake Chrome has no pid");
      }
      const orphanRecord = join(
        tmpdir(),
        "tidesurf-orphans",
        `${process.pid}-${launched.process.pid}.json`
      );
      expect(existsSync(orphanRecord)).toBe(true);

      const conn = {
        client: { close: async () => {} },
      } as unknown as CDPConnection;
      surf = Reflect.construct(TideSurf, [
        launched.process,
        new SurfingPage(conn),
        {} as TabManager,
        profile,
        false,
        false,
        "owned-page",
        undefined,
        [],
        {},
        undefined,
        launched.host,
        launched.port,
        launched.ownershipToken,
        launched.orphanToken,
      ]) as TideSurf;
      originalKill = launched.process.kill;
      Reflect.set(launched.process, "kill", () => {
        throw new Error("signal rejected");
      });

      await expect(surf.close()).rejects.toBeInstanceOf(ChromeLaunchError);
      expect(isOwnedBrowserEndpoint(launched.host, launched.port)).toBe(true);
      expect(existsSync(orphanRecord)).toBe(true);
      expect(Reflect.get(surf, "exitHandler")).not.toBeNull();

      Reflect.set(launched.process, "kill", originalKill);
      originalKill = undefined;
      await expect(surf.close(Date.now() + 2_000)).resolves.toBeUndefined();
      expect(Reflect.get(surf, "exitHandler")).toBeNull();
      expect(isOwnedBrowserEndpoint(launched.host, launched.port)).toBe(false);
      expect(existsSync(orphanRecord)).toBe(false);
    } finally {
      if (launched) {
        if (originalKill) Reflect.set(launched.process, "kill", originalKill);
        await terminateChromeProcess(launched.process, 500);
        if (typeof launched.process.pid === "number") {
          unregisterOrphanedBrowser(
            process.pid,
            launched.process.pid,
            launched.orphanToken
          );
        }
        releaseOwnedBrowserEndpoint(
          launched.host,
          launched.port,
          launched.ownershipToken
        );
      }
      await closeServer(server);
      rmSync(root, { recursive: true, force: true });
    }
  }, 20_000);

  it("retains the profile cleanup record until rm succeeds and retries", async () => {
    if (process.platform === "win32") return;
    const server = createDevToolsServer("/devtools/browser/profile-retry", [
      { id: "profile-retry-page", type: "page" },
    ]);
    const port = await listen(server, "127.0.0.1");
    const root = mkdtempSync(join(tmpdir(), "tidesurf-profile-retry-"));
    const fakeChrome = join(root, "fake-chrome");
    writeFileSync(
      fakeChrome,
      `#!/usr/bin/env node
const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const prefix = "--user-data-dir=";
const argument = process.argv.find((value) => value.startsWith(prefix));
if (!argument) process.exit(2);
const profile = argument.slice(prefix.length);
mkdirSync(profile, { recursive: true });
writeFileSync(join(profile, "DevToolsActivePort"), ${JSON.stringify(
        `${port}\n/devtools/browser/profile-retry\n`
      )});
setInterval(() => {}, 1000);
`,
      { mode: 0o755 }
    );
    chmodSync(fakeChrome, 0o755);

    let launched: Awaited<ReturnType<typeof launchChrome>> | undefined;
    try {
      launched = await launchChrome({ chromePath: fakeChrome, timeout: 8_000 });
      if (typeof launched.process.pid !== "number") {
        throw new Error("fake Chrome has no pid");
      }
      const orphanRecord = join(
        tmpdir(),
        "tidesurf-orphans",
        `${process.pid}-${launched.process.pid}.json`
      );
      const originalProfile = launched.userDataDir;
      const conn = {
        client: { close: async () => {} },
      } as unknown as CDPConnection;
      const surf = Reflect.construct(TideSurf, [
        launched.process,
        new SurfingPage(conn),
        {} as TabManager,
        originalProfile,
        true,
        false,
        "profile-retry-page",
        undefined,
        [],
        {},
        undefined,
        launched.host,
        launched.port,
        launched.ownershipToken,
        launched.orphanToken,
      ]) as TideSurf;

      // Deterministic ENOTDIR failure without mocking the fs module.
      Reflect.set(surf, "userDataDir", "/dev/null/tidesurf-profile");
      await expect(surf.close(Date.now() + 2_000)).rejects.toThrow(
        "Failed to remove temporary Chrome profile"
      );
      expect(Reflect.get(surf, "exitHandler")).toBeNull();
      expect(existsSync(orphanRecord)).toBe(true);
      expect(existsSync(originalProfile)).toBe(true);

      Reflect.set(surf, "userDataDir", originalProfile);
      await expect(surf.close(Date.now() + 2_000)).resolves.toBeUndefined();
      expect(existsSync(originalProfile)).toBe(false);
      expect(existsSync(orphanRecord)).toBe(false);
    } finally {
      if (launched) {
        await terminateChromeProcess(launched.process, 500);
        if (typeof launched.process.pid === "number") {
          unregisterOrphanedBrowser(
            process.pid,
            launched.process.pid,
            launched.orphanToken
          );
        }
        releaseOwnedBrowserEndpoint(
          launched.host,
          launched.port,
          launched.ownershipToken
        );
        rmSync(launched.userDataDir, { recursive: true, force: true });
      }
      await closeServer(server);
      rmSync(root, { recursive: true, force: true });
    }
  }, 20_000);

  it("does not let a late endpoint release clear a replacement claim", async () => {
    if (process.platform === "win32") return;
    const server = createDevToolsServer("/devtools/browser/generation", [
      { id: "generation-page", type: "page" },
    ]);
    const port = await listen(server, "127.0.0.1");
    const root = mkdtempSync(join(tmpdir(), "tidesurf-endpoint-generation-"));
    const fakeChrome = join(root, "fake-chrome");
    writeFileSync(
      fakeChrome,
      `#!/usr/bin/env node
const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const prefix = "--user-data-dir=";
const argument = process.argv.find((value) => value.startsWith(prefix));
if (!argument) process.exit(2);
const profile = argument.slice(prefix.length);
mkdirSync(profile, { recursive: true });
writeFileSync(join(profile, "DevToolsActivePort"), ${JSON.stringify(
        `${port}\n/devtools/browser/generation\n`
      )});
setInterval(() => {}, 1000);
`,
      { mode: 0o755 }
    );
    chmodSync(fakeChrome, 0o755);

    let first: Awaited<ReturnType<typeof launchChrome>> | undefined;
    let replacement: Awaited<ReturnType<typeof launchChrome>> | undefined;
    try {
      first = await launchChrome({
        chromePath: fakeChrome,
        userDataDir: join(root, "first-profile"),
        timeout: 8_000,
      });
      replacement = await launchChrome({
        chromePath: fakeChrome,
        userDataDir: join(root, "replacement-profile"),
        timeout: 8_000,
      });
      expect(replacement.ownershipToken).not.toBe(first.ownershipToken);
      expect(
        releaseOwnedBrowserEndpoint(
          first.host,
          first.port,
          first.ownershipToken
        )
      ).toBe(false);
      expect(isOwnedBrowserEndpoint(first.host, first.port)).toBe(true);
      expect(await verifyOwnedBrowserEndpoint(first.host, first.port)).toBe(true);
    } finally {
      for (const launched of [first, replacement]) {
        if (!launched) continue;
        await terminateChromeProcess(launched.process, 500);
        if (typeof launched.process.pid === "number") {
          unregisterOrphanedBrowser(
            process.pid,
            launched.process.pid,
            launched.orphanToken
          );
        }
      }
      if (replacement) {
        releaseOwnedBrowserEndpoint(
          replacement.host,
          replacement.port,
          replacement.ownershipToken
        );
      }
      await closeServer(server);
      rmSync(root, { recursive: true, force: true });
    }
  }, 20_000);

  it("does not accept a managed launch marker for another browser", async () => {
    if (process.platform === "win32") return;
    const server = createDevToolsServer("/devtools/browser/other", [
      { id: "other-page", type: "page" },
    ]);
    const port = await listen(server, "127.0.0.1");
    const root = mkdtempSync(join(tmpdir(), "tidesurf-launch-identity-"));
    const profile = join(root, "profile");
    const fakeChrome = join(root, "fake-chrome");
    writeFileSync(
      fakeChrome,
      `#!/usr/bin/env node
const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const prefix = "--user-data-dir=";
const argument = process.argv.find((value) => value.startsWith(prefix));
if (!argument) process.exit(2);
const profile = argument.slice(prefix.length);
mkdirSync(profile, { recursive: true });
writeFileSync(join(profile, "DevToolsActivePort"), ${JSON.stringify(
        `${port}\n/devtools/browser/launched\n`
      )});
setInterval(() => {}, 1000);
`,
      { mode: 0o755 }
    );
    chmodSync(fakeChrome, 0o755);

    try {
      let failure: unknown;
      try {
        await launchChrome({
          chromePath: fakeChrome,
          userDataDir: profile,
          timeout: 8_000,
        });
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(ChromeLaunchError);
      expect((failure as Error).message).toContain("does not match");
    } finally {
      await closeServer(server);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not launch into a profile with a malformed active marker", async () => {
    if (process.platform === "win32") return;
    const root = mkdtempSync(join(tmpdir(), "tidesurf-existing-marker-"));
    const profile = join(root, "profile");
    const sentinel = join(root, "launched");
    const fakeChrome = join(root, "fake-chrome");
    mkdirSync(profile);
    writeFileSync(
      join(profile, "DevToolsActivePort"),
      "not-a-port\n/devtools/browser/ambiguous\n"
    );
    writeFileSync(
      fakeChrome,
      `#!/bin/sh\ntouch ${JSON.stringify(sentinel)}\n`,
      { mode: 0o755 }
    );
    chmodSync(fakeChrome, 0o755);

    try {
      await expect(
        launchChrome({ chromePath: fakeChrome, userDataDir: profile })
      ).rejects.toThrow("invalid port");
      expect(existsSync(sentinel)).toBe(false);
      expect(existsSync(join(profile, "DevToolsActivePort"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects an explicit port collision before spawning Chrome", async () => {
    const server = createServer();
    const port = await listen(server, "127.0.0.1");
    const root = mkdtempSync(join(tmpdir(), "tidesurf-collision-"));
    const fakeChrome = join(root, process.platform === "win32" ? "chrome.exe" : "chrome");
    writeFileSync(fakeChrome, "not launched", { mode: 0o755 });
    chmodSync(fakeChrome, 0o755);
    try {
      await expect(
        launchChrome({ chromePath: fakeChrome, port, timeout: 500 })
      ).rejects.toThrow(`Port ${port} is already in use`);
    } finally {
      await closeServer(server);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a foreign endpoint that steals an explicit port after the probe", async () => {
    if (process.platform === "win32") return;
    const reservation = createServer();
    const port = await listen(reservation, "127.0.0.1");
    await closeServer(reservation);

    const root = mkdtempSync(join(tmpdir(), "tidesurf-explicit-foreign-"));
    const profile = join(root, "profile");
    const foreignPidFile = join(root, "foreign.pid");
    const fakeChrome = join(root, "fake-chrome");
    const foreignSource = `
const http = require("node:http");
const port = Number(process.env.TIDESURF_FOREIGN_PORT);
const server = http.createServer((request, response) => {
  let body;
  if (request.url === "/json/version") {
    body = { webSocketDebuggerUrl: "ws://127.0.0.1:" + port + "/devtools/browser/foreign" };
  } else if (request.url === "/json/list" || request.url === "/json") {
    body = [{ id: "foreign-page", type: "page" }];
  } else {
    response.writeHead(404);
    response.end();
    return;
  }
  response.writeHead(200, { "content-type": "application/json", connection: "close" });
  response.end(JSON.stringify(body));
});
server.listen(port, "127.0.0.1");
setInterval(() => {}, 1000);
`;
    writeFileSync(
      fakeChrome,
      `#!/usr/bin/env node
const { spawn } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const portArg = process.argv.find((value) => value.startsWith("--remote-debugging-port="));
if (!portArg) process.exit(2);
const port = portArg.slice("--remote-debugging-port=".length);
const foreign = spawn(process.execPath, ["-e", ${JSON.stringify(foreignSource)}], {
  env: { ...process.env, TIDESURF_FOREIGN_PORT: port },
  stdio: "ignore",
});
writeFileSync(${JSON.stringify(foreignPidFile)}, String(foreign.pid));
const stop = () => {
  try { foreign.kill("SIGKILL"); } catch {}
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
setInterval(() => {}, 1000);
`,
      { mode: 0o755 }
    );
    chmodSync(fakeChrome, 0o755);

    try {
      await expect(
        launchChrome({
          chromePath: fakeChrome,
          userDataDir: profile,
          port,
          timeout: 1_200,
        })
      ).rejects.toThrow("Timed out waiting for Chrome DevTools");
      expect(isOwnedBrowserEndpoint("127.0.0.1", port)).toBe(false);
    } finally {
      if (existsSync(foreignPidFile)) {
        const foreignPid = Number(readFileSync(foreignPidFile, "utf8"));
        if (Number.isInteger(foreignPid) && foreignPid > 0) {
          try {
            process.kill(foreignPid, "SIGKILL");
          } catch {
            // already stopped with the fake parent
          }
        }
      }
      rmSync(root, { recursive: true, force: true });
    }
  }, 10_000);

  it("fails fast on a malformed launch marker and cleans the child/profile", async () => {
    if (process.platform === "win32") return;
    const root = mkdtempSync(join(tmpdir(), "tidesurf-malformed-launch-"));
    const fakeChrome = join(root, "fake-chrome");
    const infoPath = join(root, "process.json");
    writeFileSync(
      fakeChrome,
      `#!/usr/bin/env node
const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const prefix = "--user-data-dir=";
const argument = process.argv.find((value) => value.startsWith(prefix));
if (!argument) process.exit(2);
const profile = argument.slice(prefix.length);
mkdirSync(profile, { recursive: true });
writeFileSync(${JSON.stringify(infoPath)}, JSON.stringify({ pid: process.pid, profile }));
writeFileSync(join(profile, "DevToolsActivePort"), "not-a-port\\n/devtools/browser/bad\\n");
setInterval(() => {}, 1000);
`,
      { mode: 0o755 }
    );
    chmodSync(fakeChrome, 0o755);

    let launched: Awaited<ReturnType<typeof launchChrome>> | undefined;
    let failure: unknown;
    const started = Date.now();
    try {
      try {
        launched = await launchChrome({ chromePath: fakeChrome, timeout: 4_000 });
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(ChromeLaunchError);
      expect((failure as Error).message).toContain("invalid port");
      expect(Date.now() - started).toBeLessThan(1_500);

      const info = JSON.parse(readFileSync(infoPath, "utf8")) as {
        pid: number;
        profile: string;
      };
      expect(existsSync(info.profile)).toBe(false);
      expect(() => process.kill(info.pid, 0)).toThrow();
    } finally {
      if (launched) await terminateChromeProcess(launched.process, 500);
      rmSync(root, { recursive: true, force: true });
    }
  }, 10_000);
});
