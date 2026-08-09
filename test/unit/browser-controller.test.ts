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

describe("BrowserController browser-free lifecycle", () => {
  it("tracks accepted browser-free work during close and rejects it after close", async () => {
    const controller = new BrowserController(sessionConfig());
    let release!: () => void;
    let markStarted!: () => void;
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    const started = new Promise<void>((resolveStarted) => {
      markStarted = resolveStarted;
    });
    const runBrowserFree = Reflect.get(controller, "runBrowserFree") as (
      operation: () => Promise<string>
    ) => Promise<string>;
    const operation = runBrowserFree.call(controller, async () => {
      markStarted();
      await gate;
      return "done";
    });
    await started;

    const closing = controller.close();
    let closeSettled = false;
    void closing.then(
      () => { closeSettled = true; },
      () => { closeSettled = true; }
    );
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
    expect(closeSettled).toBe(false);

    release();
    await expect(operation).resolves.toBe("done");
    await expect(closing).resolves.toBeUndefined();
    await expect(controller.execute("list_skills", {})).rejects.toBeInstanceOf(
      CDPConnectionError
    );
  });
});

describe("BrowserController bounded close", () => {
  it("returns by one deadline and cleans an acquisition that resolves late", async () => {
    const controller = new BrowserController(sessionConfig());
    const { surf } = surfInstance();
    let releaseAcquire!: () => void;
    let markAcquireStarted!: () => void;
    const acquireGate = new Promise<void>((resolveAcquire) => {
      releaseAcquire = resolveAcquire;
    });
    const acquireStarted = new Promise<void>((resolveStarted) => {
      markAcquireStarted = resolveStarted;
    });
    const closeBrowser = mock(async () => {});
    Reflect.set(surf, "close", closeBrowser);
    Reflect.set(controller, "acquire", mock(async () => {
      markAcquireStarted();
      await acquireGate;
      return surf;
    }));

    const opening = controller.getBrowser();
    await acquireStarted;
    const started = Date.now();
    await expect(controller.close(Date.now() + 40)).rejects.toThrow(
      "close deadline"
    );
    expect(Date.now() - started).toBeLessThan(500);

    releaseAcquire();
    await expect(opening).resolves.toBe(surf);
    for (let attempt = 0; attempt < 20 && closeBrowser.mock.calls.length === 0; attempt++) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
    }
    expect(closeBrowser).toHaveBeenCalledTimes(1);
    await expect(controller.close(Date.now() + 200)).resolves.toBeUndefined();
  });

  it("does not await an unresolved dead-browser disposal after timeout", async () => {
    const controller = new BrowserController(sessionConfig());
    const { surf } = surfInstance();
    let releaseClose!: () => void;
    const closeGate = new Promise<void>((resolveClose) => {
      releaseClose = resolveClose;
    });
    Reflect.set(surf, "close", mock(async () => closeGate));
    Reflect.set(controller, "acquire", mock(async () => surf));
    await controller.start();
    markDisconnected(surf);
    controller.status();

    const started = Date.now();
    await expect(controller.close(Date.now() + 40)).rejects.toThrow(
      "close deadline"
    );
    expect(Date.now() - started).toBeLessThan(500);
    releaseClose();
    await expect(controller.close(Date.now() + 200)).resolves.toBeUndefined();
  });

  it("preserves a failed browser close for an explicit retry", async () => {
    const controller = new BrowserController(sessionConfig());
    const { surf } = surfInstance();
    let closeCalls = 0;
    Reflect.set(surf, "close", mock(async () => {
      closeCalls++;
      if (closeCalls === 1) throw new Error("first close failed");
    }));
    Reflect.set(controller, "acquire", mock(async () => surf));
    await controller.start();

    await expect(controller.close(Date.now() + 200)).rejects.toThrow(
      "first close failed"
    );
    await expect(controller.close(Date.now() + 200)).resolves.toBeUndefined();
    expect(closeCalls).toBe(2);
  });

  it("starts browser close before waiting for serialized work", async () => {
    const controller = new BrowserController(sessionConfig());
    const { surf } = surfInstance();
    Reflect.set(controller, "acquire", mock(async () => surf));
    await controller.start();

    let releaseWork!: () => void;
    let markWorkStarted!: () => void;
    let markCloseStarted!: () => void;
    const workGate = new Promise<void>((resolveWork) => {
      releaseWork = resolveWork;
    });
    const workStarted = new Promise<void>((resolveStarted) => {
      markWorkStarted = resolveStarted;
    });
    const closeStarted = new Promise<void>((resolveStarted) => {
      markCloseStarted = resolveStarted;
    });
    Reflect.set(surf, "close", mock(async () => {
      markCloseStarted();
    }));
    const runSerialized = Reflect.get(controller, "runSerialized") as (
      operation: () => Promise<void>
    ) => Promise<void>;
    const work = runSerialized.call(controller, async () => {
      markWorkStarted();
      await workGate;
    });
    await workStarted;
    const closing = controller.close(Date.now() + 500);

    await closeStarted;
    releaseWork();
    await work;
    await expect(closing).resolves.toBeUndefined();
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
