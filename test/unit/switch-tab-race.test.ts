import { describe, expect, it, mock } from "bun:test";
import type { ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CDPConnection } from "../../src/cdp/connection.js";
import { SurfingPage } from "../../src/cdp/page.js";
import type { TabManager } from "../../src/cdp/tab-manager.js";
import { TideSurf } from "../../src/tidesurf.js";
import {
  ActionCommittedError,
  CDPConnectionError,
  ChromeLaunchError,
  ValidationError,
} from "../../src/errors.js";

function connection(options: {
  close?: () => Promise<void>;
  applyViewport?: () => Promise<void>;
} = {}): CDPConnection {
  return {
    client: {
      close: options.close ?? mock(async () => {}),
    },
    Emulation: {
      setDeviceMetricsOverride:
        options.applyViewport ?? mock(async () => {}),
    },
  } as unknown as CDPConnection;
}

function instance(
  tabManager: Pick<TabManager, "connectToTab">,
  defaultViewport?: { width: number; height: number },
  urlValidationOptions: { allowLocalhost?: boolean } = {}
): TideSurf {
  const initialPage = new SurfingPage(connection());
  return Reflect.construct(TideSurf, [
    null,
    initialPage,
    tabManager,
    "",
    false,
    false,
    "initial",
    defaultViewport,
    [],
    urlValidationOptions,
    undefined,
    "localhost",
    9222,
  ]) as TideSurf;
}

describe("TideSurf.switchTab", () => {
  it("disconnects a new tab when viewport setup fails", async () => {
    const close = mock(async () => {});
    const applyViewport = mock(async () => {
      throw new Error("viewport setup failed");
    });
    const conn = connection({ close, applyViewport });
    const connectToTab = mock(async () => conn);
    const surf = instance(
      { connectToTab } as Pick<TabManager, "connectToTab">,
      { width: 1280, height: 720 }
    );

    await expect(surf.switchTab("next")).rejects.toThrow(
      "viewport setup failed"
    );

    expect(connectToTab).toHaveBeenCalledTimes(1);
    expect(applyViewport).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("reports a failed tab rollback without hiding the setup failure", async () => {
    const setupError = new Error("viewport setup failed");
    const disconnectError = new Error("disconnect failed");
    const conn = connection({
      close: mock(async () => {
        throw disconnectError;
      }),
      applyViewport: mock(async () => {
        throw setupError;
      }),
    });
    const surf = instance(
      { connectToTab: mock(async () => conn) } as Pick<
        TabManager,
        "connectToTab"
      >,
      { width: 1280, height: 720 }
    );

    let failure: unknown;
    try {
      await surf.switchTab("next");
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(CDPConnectionError);
    expect((failure as Error).message).toContain("rollback did not complete");
    const cause = (failure as Error & { cause?: unknown }).cause;
    expect(cause).toBeInstanceOf(AggregateError);
    expect((cause as AggregateError).errors).toEqual([
      setupError,
      disconnectError,
    ]);
  });

  it("keeps a successfully initialized tab active", async () => {
    const close = mock(async () => {});
    const conn = connection({ close });
    const surf = instance(
      {
        connectToTab: mock(async () => conn),
      } as Pick<TabManager, "connectToTab">,
      { width: 1280, height: 720 }
    );

    await surf.switchTab("next");

    expect(surf.getPage()).toBeInstanceOf(SurfingPage);
    expect(close).not.toHaveBeenCalled();
  });

  it("shares one CDP connection for concurrent switches to the same tab", async () => {
    let releaseConnection!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseConnection = resolve;
    });
    const conn = connection();
    const connectToTab = mock(async () => {
      await gate;
      return conn;
    });
    const surf = instance({ connectToTab } as Pick<TabManager, "connectToTab">);

    const first = surf.switchTab("next");
    const second = surf.switchTab("next");
    releaseConnection();
    await Promise.all([first, second]);

    expect(connectToTab).toHaveBeenCalledTimes(1);
    expect(Reflect.get(surf, "activeTabId")).toBe("next");
    await surf.close();
  });

  it("serializes switching to and closing the same uncached tab", async () => {
    let releaseConnection!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseConnection = resolve;
    });
    const nextClose = mock(async () => {});
    const closeTab = mock(async () => {});
    const tabManager = {
      connectToTab: mock(async () => {
        await gate;
        return connection({ close: nextClose });
      }),
      listTabs: mock(async () => [
        { id: "initial", url: "about:blank", title: "", type: "page" },
        { id: "next", url: "about:blank", title: "", type: "page" },
      ]),
      closeTab,
    };
    const surf = instance(
      tabManager as unknown as Pick<TabManager, "connectToTab">
    );

    const switching = surf.switchTab("next");
    const closing = surf.closeTab("next");
    expect(closeTab).not.toHaveBeenCalled();

    releaseConnection();
    await switching;
    await closing;

    expect(closeTab).toHaveBeenCalledWith("next", undefined);
    expect(nextClose).toHaveBeenCalledTimes(1);
    expect(Reflect.get(surf, "activeTabId")).toBe("initial");
    await surf.close();
  });

  it("preserves connection failures", async () => {
    const surf = instance({
      connectToTab: mock(async () => {
        throw new Error("tab not found");
      }),
    } as Pick<TabManager, "connectToTab">);

    await expect(surf.switchTab("missing")).rejects.toThrow("tab not found");
  });

  it("disconnects a tab whose setup loses a race with close", async () => {
    let releaseViewport!: () => void;
    const viewportGate = new Promise<void>((resolve) => {
      releaseViewport = resolve;
    });
    const close = mock(async () => {});
    const applyViewport = mock(async () => viewportGate);
    const conn = connection({ close, applyViewport });
    const surf = instance(
      { connectToTab: mock(async () => conn) } as Pick<
        TabManager,
        "connectToTab"
      >,
      { width: 1280, height: 720 }
    );

    const switching = surf.switchTab("next");
    while (applyViewport.mock.calls.length === 0) await Promise.resolve();
    const closing = surf.close();
    releaseViewport();

    await expect(switching).rejects.toThrow("TideSurf is closed");
    await closing;
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("rejects an empty new tab URL before creating a target", async () => {
    const createTab = mock(async () => ({
      id: "new",
      url: "about:blank",
      title: "",
      type: "page",
    }));
    const surf = instance({
      connectToTab: mock(async () => connection()),
      createTab,
    } as Pick<TabManager, "connectToTab">);

    await expect(surf.newTab("")).rejects.toBeInstanceOf(ValidationError);
    expect(createTab).not.toHaveBeenCalled();
  });

  it("rolls back a new target when close starts before ownership commits", async () => {
    const replacementClose = mock(async () => {});
    const replacementPage = new SurfingPage(
      connection({ close: replacementClose })
    );
    const closeTab = mock(async () => {});
    const surf = instance({
      connectToTab: mock(async () => connection()),
      closeTab,
    } as unknown as Pick<TabManager, "connectToTab">);
    let closing!: Promise<void>;
    Reflect.set(surf, "createConnectedTabResources", mock(async () => {
      queueMicrotask(() => {
        closing = surf.close();
      });
      return {
        tab: {
          id: "new",
          url: "about:blank",
          title: "",
          type: "page",
        },
        page: replacementPage,
      };
    }));

    await expect(surf.newTab()).rejects.toThrow("TideSurf is closed");
    await closing;

    expect(replacementClose).toHaveBeenCalledTimes(1);
    expect(closeTab).toHaveBeenCalledWith("new", undefined);
  });

  it("does not expose mutable URL policy state", async () => {
    const createTab = mock(async () => ({
      id: "new",
      url: "about:blank",
      title: "",
      type: "page",
    }));
    const policy = { allowLocalhost: false };
    const surf = instance(
      {
        connectToTab: mock(async () => connection()),
        createTab,
      } as Pick<TabManager, "connectToTab">,
      undefined,
      policy
    );

    policy.allowLocalhost = true;
    surf.getUrlValidationOptions().allowLocalhost = true;

    await expect(
      surf.newTab("http://127.0.0.1/")
    ).rejects.toBeInstanceOf(ValidationError);
    expect(createTab).not.toHaveBeenCalled();
  });
});

describe("TideSurf.closeTab", () => {
  it("keeps the active target open when successor setup fails", async () => {
    const closeTab = mock(async (_id: string) => {});
    const tabManager = {
      listTabs: mock(async () => [
        { id: "initial", url: "about:blank", title: "", type: "page" },
        { id: "next", url: "about:blank", title: "", type: "page" },
      ]),
      connectToTab: mock(async () => {
        throw new Error("successor setup failed");
      }),
      closeTab,
    };
    const surf = instance(
      tabManager as unknown as Pick<TabManager, "connectToTab">
    );

    await expect(surf.closeTab("initial")).rejects.toThrow(
      "successor setup failed"
    );

    expect(closeTab).not.toHaveBeenCalled();
    expect(Reflect.get(surf, "activeTabId")).toBe("initial");
    expect(surf.getPage()).toBeInstanceOf(SurfingPage);
  });

  it("connects a replacement before closing the final target", async () => {
    const calls: string[] = [];
    const replacementConnection = connection();
    const tabManager = {
      listTabs: mock(async () => [
        { id: "initial", url: "about:blank", title: "", type: "page" },
      ]),
      createTab: mock(async () => {
        calls.push("create");
        return {
          id: "replacement",
          url: "about:blank",
          title: "",
          type: "page",
        };
      }),
      connectToTab: mock(async () => {
        calls.push("connect");
        return replacementConnection;
      }),
      closeTab: mock(async (id: string) => {
        calls.push(`close:${id}`);
      }),
    };
    const surf = instance(
      tabManager as unknown as Pick<TabManager, "connectToTab">
    );

    await surf.closeTab("initial");

    expect(calls).toEqual(["create", "connect", "close:initial"]);
    expect(Reflect.get(surf, "activeTabId")).toBe("replacement");
    expect(surf.getPage()).toBeInstanceOf(SurfingPage);
  });

  it("keeps the final target open when replacement setup fails", async () => {
    const closeTab = mock(async (_id: string) => {});
    const tabManager = {
      listTabs: mock(async () => [
        { id: "initial", url: "about:blank", title: "", type: "page" },
      ]),
      createTab: mock(async () => ({
        id: "replacement",
        url: "about:blank",
        title: "",
        type: "page",
      })),
      connectToTab: mock(async () => {
        throw new Error("replacement setup failed");
      }),
      closeTab,
    };
    const surf = instance(
      tabManager as unknown as Pick<TabManager, "connectToTab">
    );

    await expect(surf.closeTab("initial")).rejects.toThrow(
      "replacement setup failed"
    );

    expect(closeTab).toHaveBeenCalledTimes(1);
    expect(closeTab).toHaveBeenCalledWith("replacement", undefined);
    expect(surf.getPage()).toBeInstanceOf(SurfingPage);
  });

  it("rolls back an uncommitted replacement when close wins the race", async () => {
    const replacementClose = mock(async () => {});
    const replacementPage = new SurfingPage(
      connection({ close: replacementClose })
    );
    const closeTab = mock(async () => {});
    const tabManager = {
      listTabs: mock(async () => [
        { id: "initial", url: "about:blank", title: "", type: "page" },
      ]),
      connectToTab: mock(async () => connection()),
      closeTab,
    };
    const surf = instance(
      tabManager as unknown as Pick<TabManager, "connectToTab">
    );
    let closing!: Promise<void>;
    Reflect.set(surf, "createConnectedTabResources", mock(async () => {
      queueMicrotask(() => {
        closing = surf.close();
      });
      return {
        tab: {
          id: "replacement",
          url: "about:blank",
          title: "",
          type: "page",
        },
        page: replacementPage,
      };
    }));

    await expect(surf.closeTab("initial")).rejects.toThrow("TideSurf is closed");
    await closing;

    expect(replacementClose).toHaveBeenCalledTimes(1);
    expect(closeTab).toHaveBeenCalledTimes(1);
    expect(closeTab).toHaveBeenCalledWith("replacement", undefined);
  });

  it("reports a page disconnect failure after removing the closed tab", async () => {
    const closeTab = mock(async () => {});
    const surf = instance({
      connectToTab: mock(async () => connection()),
      closeTab,
    } as unknown as Pick<TabManager, "connectToTab">);
    const pages = Reflect.get(surf, "pages") as Map<string, SurfingPage>;
    pages.set(
      "second",
      new SurfingPage(
        connection({
          close: mock(async () => {
            throw new Error("disconnect failed");
          }),
        })
      )
    );

    await expect(surf.closeTab("second")).rejects.toBeInstanceOf(
      ActionCommittedError
    );

    expect(closeTab).toHaveBeenCalledWith("second", undefined);
    expect(pages.has("second")).toBe(false);
    expect(Reflect.get(surf, "activeTabId")).toBe("initial");
  });
});

describe("TideSurf.close", () => {
  it("reports a page disconnect failure after attempting cleanup", async () => {
    const surf = Reflect.construct(TideSurf, [
      null,
      new SurfingPage(
        connection({
          close: mock(async () => {
            throw new Error("disconnect failed");
          }),
        })
      ),
      {} as TabManager,
      "",
      false,
      false,
      "initial",
      undefined,
      [],
      {},
      undefined,
      "localhost",
      9222,
    ]) as TideSurf;

    const first = surf.close();
    await expect(first).rejects.toBeInstanceOf(CDPConnectionError);
    await expect(surf.close()).rejects.toBeInstanceOf(CDPConnectionError);
  });

  it("rejects browser operations after an attached session closes", async () => {
    const listTabs = mock(async () => []);
    const closeTab = mock(async () => {});
    const createTab = mock(async () => ({
      id: "new",
      url: "about:blank",
      title: "",
      type: "page",
    }));
    const connectToTab = mock(async () => connection());
    const surf = instance({
      listTabs,
      closeTab,
      createTab,
      connectToTab,
    } as unknown as Pick<TabManager, "connectToTab">);
    const page = surf.getPage();

    await surf.close();

    await expect(surf.navigate("https://example.com")).rejects.toBeInstanceOf(
      CDPConnectionError
    );
    await expect(surf.readPage()).rejects.toBeInstanceOf(CDPConnectionError);
    expect(() => surf.getPage()).toThrow(CDPConnectionError);
    await expect(surf.listTabs()).rejects.toBeInstanceOf(CDPConnectionError);
    await expect(surf.closeTab("second")).rejects.toBeInstanceOf(
      CDPConnectionError
    );
    await expect(surf.newTab()).rejects.toBeInstanceOf(CDPConnectionError);
    await expect(surf.switchTab("second")).rejects.toBeInstanceOf(
      CDPConnectionError
    );
    await expect(page.evaluate("1 + 1")).rejects.toBeInstanceOf(
      CDPConnectionError
    );

    expect(listTabs).not.toHaveBeenCalled();
    expect(closeTab).not.toHaveBeenCalled();
    expect(createTab).not.toHaveBeenCalled();
    expect(connectToTab).not.toHaveBeenCalled();
  });

  it("reports a TideSurf-owned Chrome process that survives termination", async () => {
    const profile = mkdtempSync(join(tmpdir(), "tidesurf-close-survivor-"));
    const closeClient = mock(async () => {});
    const kill = mock(() => {
      throw new Error("signal rejected");
    });
    const proc = {
      exitCode: null,
      signalCode: null,
      kill,
    } as unknown as ChildProcess;
    const surf = Reflect.construct(TideSurf, [
      proc,
      new SurfingPage(connection({ close: closeClient })),
      {} as TabManager,
      profile,
      true,
      false,
      "initial",
      undefined,
      [],
      {},
      undefined,
      "localhost",
      9222,
    ]) as TideSurf;

    try {
      await expect(surf.close()).rejects.toBeInstanceOf(ChromeLaunchError);
      expect(closeClient).toHaveBeenCalledTimes(1);
      expect(kill).toHaveBeenCalledTimes(1);
      expect(existsSync(profile)).toBe(true);

      await expect(surf.close()).rejects.toBeInstanceOf(ChromeLaunchError);
      expect(kill).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(profile, { recursive: true, force: true });
    }
  });
});
