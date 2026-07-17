import { describe, expect, it, mock } from "bun:test";
import { BrowserController } from "../../src/cli/browser-controller.js";
import type { SessionConfig } from "../../src/cli/session.js";
import { TideSurf } from "../../src/tidesurf.js";
import { SurfingPage } from "../../src/cdp/page.js";
import type { CDPConnection } from "../../src/cdp/connection.js";
import type { TabManager } from "../../src/cdp/tab-manager.js";
import { CDPConnectionError, ChromeLaunchError } from "../../src/errors.js";

function connection(): CDPConnection {
  return {
    client: { close: mock(async () => {}) },
  } as unknown as CDPConnection;
}

function surfInstance(): { surf: TideSurf; conn: CDPConnection } {
  const conn = connection();
  const surf = Reflect.construct(TideSurf, [
    null,
    new SurfingPage(conn),
    {} as TabManager,
    "",
    false,
    false,
    "initial",
    undefined,
    [],
    {},
    undefined,
    "127.0.0.1",
    9333,
  ]) as TideSurf;
  return { surf, conn };
}

function sessionConfig(overrides: Partial<SessionConfig> = {}): SessionConfig {
  return {
    browserMode: "auto",
    headless: true,
    readOnly: false,
    allowLocalhost: true,
    allowPrivateHosts: false,
    timeout: 5_000,
    ...overrides,
  };
}

function markDisconnected(surf: TideSurf): void {
  Reflect.set(Reflect.get(surf.getPage(), "conn"), "disconnected", true);
}

describe("BrowserController dead browser recovery", () => {
  it("reports the real state and reacquires after the browser dies", async () => {
    const controller = new BrowserController(sessionConfig());
    const first = surfInstance();
    const second = surfInstance();
    const handles = [first.surf, second.surf];
    const acquire = mock(async () => handles.shift()!);
    Reflect.set(controller, "acquire", acquire);

    await controller.start();
    expect(controller.status().running).toBe(true);
    expect(acquire).toHaveBeenCalledTimes(1);

    markDisconnected(first.surf);

    expect(controller.status().running).toBe(false);
    expect(Reflect.get(first.surf, "closePromise")).not.toBeNull();

    await expect(controller.getBrowser()).resolves.toBe(second.surf);
    expect(acquire).toHaveBeenCalledTimes(2);
    expect(controller.status().running).toBe(true);
    await controller.close();
  });

  it("does not report a dead browser as already running", async () => {
    const controller = new BrowserController(sessionConfig());
    const first = surfInstance();
    const second = surfInstance();
    const handles = [first.surf, second.surf];
    Reflect.set(controller, "acquire", mock(async () => handles.shift()!));

    await controller.start();
    markDisconnected(first.surf);

    const result = await controller.launchBrowser({});
    expect(result.alreadyRunning).toBe(false);
    await controller.close();
  });

  it("awaits the dead browser's close before relaunching its profile", async () => {
    const controller = new BrowserController(sessionConfig());
    const first = surfInstance();
    const second = surfInstance();
    const events: string[] = [];
    let releaseClose!: () => void;
    const closeGate = new Promise<void>((resolveClose) => {
      releaseClose = resolveClose;
    });
    // The evicted handle's close tears down the old Chrome; a relaunch with
    // the same profile must wait for it or hits "profile is already active".
    Reflect.set(first.surf, "close", mock(async () => {
      events.push("close:start");
      await closeGate;
      events.push("close:end");
    }));
    let acquireCalls = 0;
    Reflect.set(controller, "acquire", mock(async () => {
      acquireCalls++;
      events.push("acquire");
      return acquireCalls === 1 ? first.surf : second.surf;
    }));

    await controller.start();
    expect(await controller.getBrowser()).toBe(first.surf);
    markDisconnected(first.surf);
    events.length = 0;

    const pending = controller.getBrowser();
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
    expect(events).toEqual(["close:start"]);

    releaseClose();
    await expect(pending).resolves.toBe(second.surf);
    expect(events).toEqual(["close:start", "close:end", "acquire"]);
    await controller.close();
  });
});

describe("BrowserController pinned endpoints", () => {
  it("fails fast in connect mode without falling back to other browsers", async () => {
    const controller = new BrowserController(
      sessionConfig({ browserMode: "connect", port: 1 })
    );
    const attach = mock(async () => {
      throw new CDPConnectionError("connect ECONNREFUSED 127.0.0.1:1");
    });
    const launch = mock(async () => surfInstance().surf);
    Reflect.set(controller, "attach", attach);
    Reflect.set(controller, "launch", launch);

    await expect(controller.getBrowser()).rejects.toThrow("ECONNREFUSED");
    expect(attach).toHaveBeenCalledTimes(1);
    expect(attach.mock.calls[0][0]).toBe("127.0.0.1");
    expect(attach.mock.calls[0][1]).toBe(1);
    expect(launch).not.toHaveBeenCalled();
    await controller.close();
  });

  it("launches instead of attaching elsewhere when a pinned local endpoint fails in auto mode", async () => {
    const controller = new BrowserController(
      sessionConfig({ browserMode: "auto", browserUrl: "http://127.0.0.1:9500" })
    );
    const { surf } = surfInstance();
    const attach = mock(async () => {
      throw new CDPConnectionError("connect ECONNREFUSED 127.0.0.1:9500");
    });
    const launch = mock(async () => surf);
    Reflect.set(controller, "attach", attach);
    Reflect.set(controller, "launch", launch);

    await expect(controller.getBrowser()).resolves.toBe(surf);
    expect(attach).toHaveBeenCalledTimes(1);
    expect(attach.mock.calls[0][0]).toBe("127.0.0.1");
    expect(attach.mock.calls[0][1]).toBe(9500);
    expect(launch).toHaveBeenCalledTimes(1);
    await controller.close();
  });

  it("does not launch when a pinned remote endpoint fails", async () => {
    const controller = new BrowserController(
      sessionConfig({
        browserMode: "auto",
        browserUrl: "http://198.51.100.7:9222",
      })
    );
    const attach = mock(async () => {
      throw new CDPConnectionError("connect EHOSTUNREACH 198.51.100.7:9222");
    });
    const launch = mock(async () => surfInstance().surf);
    Reflect.set(controller, "attach", attach);
    Reflect.set(controller, "launch", launch);

    await expect(controller.getBrowser()).rejects.toThrow("EHOSTUNREACH");
    expect(attach).toHaveBeenCalledTimes(1);
    expect(launch).not.toHaveBeenCalled();
    await controller.close();
  });
});

describe("BrowserController headless override", () => {
  it("rolls back the headless override when acquisition fails", async () => {
    const controller = new BrowserController(
      sessionConfig({ headless: false, browserMode: "launch" })
    );
    Reflect.set(
      controller,
      "acquire",
      mock(async () => {
        throw new ChromeLaunchError("launch failed");
      })
    );

    await expect(controller.launchBrowser({ headless: true })).rejects.toThrow(
      "launch failed"
    );
    expect(controller.status().headless).toBe(false);

    const { surf } = surfInstance();
    Reflect.set(controller, "acquire", mock(async () => surf));
    const result = await controller.launchBrowser({});
    expect(result.headless).toBe(false);
    await controller.close();
  });

  it("applies the headless override during acquisition on success", async () => {
    const controller = new BrowserController(
      sessionConfig({ headless: false, browserMode: "launch" })
    );
    const { surf } = surfInstance();
    const seen: boolean[] = [];
    Reflect.set(
      controller,
      "acquire",
      mock(async () => {
        seen.push(controller.status().headless);
        return surf;
      })
    );

    const result = await controller.launchBrowser({ headless: true });
    expect(seen).toEqual([true]);
    expect(result.headless).toBe(true);
    expect(controller.status().headless).toBe(true);
    await controller.close();
  });
});
