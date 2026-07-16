import { afterEach, describe, expect, it, mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrowserController } from "../../src/cli/browser-controller.js";
import { TideSurf } from "../../src/tidesurf.js";
import { SurfingPage } from "../../src/cdp/page.js";
import type { CDPConnection } from "../../src/cdp/connection.js";
import type { SessionConfig } from "../../src/cli/session.js";
import { CDPConnectionError } from "../../src/errors.js";

const originalLaunch = TideSurf.launch;
const originalConnect = TideSurf.connect;
const profiles = new Set<string>();
const config: SessionConfig = {
  browserMode: "launch",
  headless: true,
  readOnly: false,
  allowLocalhost: false,
  allowPrivateHosts: false,
};

function replaceLaunch(
  implementation: (options: Parameters<typeof TideSurf.launch>[0]) => Promise<TideSurf>
): void {
  (TideSurf as unknown as { launch: typeof TideSurf.launch }).launch = implementation;
}

function replaceConnect(
  implementation: (options: Parameters<typeof TideSurf.connect>[0]) => Promise<TideSurf>
): void {
  (TideSurf as unknown as { connect: typeof TideSurf.connect }).connect = implementation;
}

function emptyProfile(): string {
  const profile = mkdtempSync(join(tmpdir(), "tidesurf-controller-"));
  profiles.add(profile);
  return profile;
}

function fakeBrowser(close = mock(async () => {})): TideSurf {
  const conn = { client: { close: mock(async () => {}) } } as unknown as CDPConnection;
  const page = new SurfingPage(conn);
  return {
    close,
    getPage: () => page,
    getToolExecutor: () => mock(async () => ({ success: true })),
  } as unknown as TideSurf;
}

afterEach(() => {
  (TideSurf as unknown as { launch: typeof TideSurf.launch }).launch = originalLaunch;
  (TideSurf as unknown as { connect: typeof TideSurf.connect }).connect = originalConnect;
  for (const profile of profiles) rmSync(profile, { recursive: true, force: true });
  profiles.clear();
});
describe("BrowserController initialization", () => {
  it("shares one launch across concurrent callers", async () => {
    const browser = fakeBrowser();
    const launch = mock(async () => {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
      return browser;
    });
    replaceLaunch(launch);
    const controller = new BrowserController(config);

    const results = await Promise.all([
      controller.getBrowser(),
      controller.getBrowser(),
      controller.getBrowser(),
    ]);

    expect(launch).toHaveBeenCalledTimes(1);
    expect(results.every((result) => result === browser)).toBe(true);
    await controller.close();
  });

  it("retries after a failed launch", async () => {
    const browser = fakeBrowser();
    let attempts = 0;
    replaceLaunch(mock(async () => {
      attempts++;
      if (attempts === 1) throw new Error("launch failed");
      return browser;
    }));
    const controller = new BrowserController(config);

    await expect(controller.getBrowser()).rejects.toThrow("launch failed");
    expect(await controller.getBrowser()).toBe(browser);
    expect(attempts).toBe(2);
    await controller.close();
  });

  it("waits for an in-flight launch before closing", async () => {
    const close = mock(async () => {});
    const browser = fakeBrowser(close);
    let release!: () => void;
    replaceLaunch(mock(async () => {
      await new Promise<void>((resolveLaunch) => { release = resolveLaunch; });
      return browser;
    }));
    const controller = new BrowserController(config);
    const opening = controller.getBrowser();
    const closing = controller.close();

    expect(close).toHaveBeenCalledTimes(0);
    release();
    await Promise.all([opening, closing]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("closes idempotently and rejects later acquisition", async () => {
    const close = mock(async () => {});
    replaceLaunch(mock(async () => fakeBrowser(close)));
    const controller = new BrowserController(config);
    await controller.getBrowser();

    await Promise.all([controller.close(), controller.close(), controller.close()]);

    expect(close).toHaveBeenCalledTimes(1);
    await expect(controller.getBrowser()).rejects.toThrow("closed");
  });

  it("does not retry a failed browser close", async () => {
    const close = mock(async () => {
      throw new Error("close failed");
    });
    replaceLaunch(mock(async () => fakeBrowser(close)));
    const controller = new BrowserController(config);
    await controller.getBrowser();

    await expect(controller.close()).rejects.toThrow("close failed");
    await expect(controller.close()).rejects.toThrow("close failed");

    expect(close).toHaveBeenCalledTimes(1);
  });

  it("honors a configured acquisition timeout without a hidden floor", async () => {
    const observedTimeouts: number[] = [];
    const connect = mock(async (options: Parameters<typeof TideSurf.connect>[0]) => {
      const timeout = options?.timeout ?? 0;
      observedTimeouts.push(timeout);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, timeout));
      throw new CDPConnectionError("conventional endpoint timed out");
    });
    const launch = mock(async () => fakeBrowser());
    replaceConnect(connect);
    replaceLaunch(launch);
    const controller = new BrowserController({
      ...config,
      browserMode: "connect",
      timeout: 100,
      userDataDir: emptyProfile(),
    });

    const started = Date.now();
    await expect(controller.getBrowser()).rejects.toThrow("conventional endpoint timed out");
    const elapsed = Date.now() - started;

    expect(observedTimeouts).toHaveLength(1);
    expect(observedTimeouts[0]).toBeGreaterThan(0);
    expect(observedTimeouts[0]).toBeLessThanOrEqual(100);
    expect(elapsed).toBeLessThan(500);
    expect(launch).toHaveBeenCalledTimes(0);
    await controller.close();
  });

  it("reports the latest conventional endpoint failure", async () => {
    const connect = mock(async () => {
      throw new CDPConnectionError("conventional endpoint refused the connection");
    });
    replaceConnect(connect);
    const controller = new BrowserController({
      ...config,
      browserMode: "connect",
      timeout: 1_000,
      userDataDir: emptyProfile(),
    });

    await expect(controller.getBrowser()).rejects.toThrow(
      "conventional endpoint refused the connection"
    );
    expect(connect).toHaveBeenCalledTimes(1);
    await controller.close();
  });

  it("falls back from local attachment to a managed launch", async () => {
    const browser = fakeBrowser();
    const connect = mock(async () => {
      throw new CDPConnectionError("endpoint unavailable");
    });
    const launch = mock(async () => browser);
    replaceConnect(connect);
    replaceLaunch(launch);
    const controller = new BrowserController({
      ...config,
      browserMode: "auto",
      host: "127.0.0.1",
      port: 9_333,
      timeout: 2_000,
      userDataDir: emptyProfile(),
    });

    expect(await controller.getBrowser()).toBe(browser);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(launch).toHaveBeenCalledTimes(1);
    expect(launch.mock.calls[0]?.[0]).toMatchObject({ port: 9_333 });
    expect(controller.status().source).toBe("launched");
    await controller.close();
  });

  it("never launches in connect-only mode", async () => {
    const connect = mock(async () => {
      throw new CDPConnectionError("no attachable browser");
    });
    const launch = mock(async () => fakeBrowser());
    replaceConnect(connect);
    replaceLaunch(launch);
    const controller = new BrowserController({
      ...config,
      browserMode: "connect",
      timeout: 1_000,
      userDataDir: emptyProfile(),
    });

    await expect(controller.getBrowser()).rejects.toThrow("no attachable browser");
    expect(connect).toHaveBeenCalledTimes(1);
    expect(launch).toHaveBeenCalledTimes(0);
    await controller.close();
  });

  it("fails fast when an explicit connect-only endpoint is unavailable", async () => {
    const connect = mock(async (options: Parameters<typeof TideSurf.connect>[0]) => {
      if (options?.port === 9_333) {
        throw new CDPConnectionError("explicit endpoint unavailable");
      }
      return fakeBrowser();
    });
    const launch = mock(async () => fakeBrowser());
    replaceConnect(connect);
    replaceLaunch(launch);
    const controller = new BrowserController({
      ...config,
      browserMode: "connect",
      host: "127.0.0.1",
      port: 9_333,
      timeout: 1_000,
      userDataDir: emptyProfile(),
    });

    await expect(controller.getBrowser()).rejects.toThrow("explicit endpoint unavailable");
    expect(connect).toHaveBeenCalledTimes(1);
    expect(launch).toHaveBeenCalledTimes(0);
    await controller.close();
  });

  it("does not turn a failed remote attachment into local discovery or launch", async () => {
    const connect = mock(async () => {
      throw new CDPConnectionError("remote endpoint unavailable");
    });
    const launch = mock(async () => fakeBrowser());
    replaceConnect(connect);
    replaceLaunch(launch);
    const controller = new BrowserController({
      ...config,
      browserMode: "auto",
      host: "192.0.2.25",
      port: 9_333,
      timeout: 1_000,
      userDataDir: emptyProfile(),
    });

    await expect(controller.getBrowser()).rejects.toThrow("remote endpoint unavailable");
    expect(connect).toHaveBeenCalledTimes(1);
    expect(launch).toHaveBeenCalledTimes(0);
    await controller.close();
  });
});
