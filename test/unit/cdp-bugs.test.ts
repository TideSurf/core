import { describe, expect, it, mock } from "bun:test";
import {
  clickNode,
  captureScreenshot,
  clipboardWrite,
  disconnect,
  evaluate,
  navigate,
  selectOption,
  setFileInput,
  scroll,
  typeText,
  waitForStable,
  type CDPConnection,
} from "../../src/cdp/connection.js";
import { downloadFromAction } from "../../src/cdp/download-manager.js";
import { CDPTimeoutError, NavigationError, ValidationError } from "../../src/errors.js";

function connection(overrides: Partial<CDPConnection> = {}): CDPConnection {
  return {
    client: { close: mock(async () => {}) } as unknown as CDPConnection["client"],
    DOM: {
      resolveNode: mock(async () => ({ object: { objectId: "object-1" } })),
    } as unknown as CDPConnection["DOM"],
    Page: {
      navigate: mock(async () => ({})),
      lifecycleEvent: mock(() => () => {}),
      on: mock(() => () => {}),
    } as unknown as CDPConnection["Page"],
    Runtime: {
      evaluate: mock(async () => ({ result: { value: undefined } })),
      callFunctionOn: mock(async () => ({})),
      releaseObject: mock(async () => ({})),
    } as unknown as CDPConnection["Runtime"],
    Input: {} as CDPConnection["Input"],
    Emulation: {} as CDPConnection["Emulation"],
    ...overrides,
  };
}

function connectionForPageObject(
  target: Record<string, unknown>
): CDPConnection {
  target.matches ??= () => false;
  target.closest ??= () => null;
  target.contains ??= () => false;
  target.getRootNode ??= () => target.ownerDocument ?? {};
  const ownerDocument = (target.ownerDocument ?? {}) as Record<string, unknown>;
  ownerDocument.defaultView ??= {
    getComputedStyle: () => ({ pointerEvents: "auto" }),
    HTMLInputElement: { prototype: {} },
    HTMLTextAreaElement: { prototype: {} },
  };
  target.ownerDocument = ownerDocument;
  const callFunctionOn = mock(
    async (params: {
      functionDeclaration: string;
      arguments?: Array<{ value?: unknown }>;
    }) => {
      try {
        const fn = new Function(
          `return (${params.functionDeclaration})`
        )() as (...args: unknown[]) => unknown;
        const args = params.arguments?.map((argument) => argument.value) ?? [];
        return { result: { value: fn.apply(target, args) } };
      } catch (error) {
        return {
          result: {},
          exceptionDetails: {
            text: "Uncaught",
            exception: {
              description: error instanceof Error ? error.message : String(error),
            },
          },
        };
      }
    }
  );
  return connection({
    Runtime: {
      callFunctionOn,
      releaseObject: mock(async () => ({})),
      evaluate: mock(async () => ({ result: { value: undefined } })),
    } as unknown as CDPConnection["Runtime"],
  });
}

describe("CDP operations", () => {
  it("times out a stalled scroll", async () => {
    const conn = connection({
      Runtime: {
        evaluate: mock(() => new Promise(() => {})),
      } as unknown as CDPConnection["Runtime"],
    });

    await expect(scroll(conn, "down", 100, 5)).rejects.toBeInstanceOf(CDPTimeoutError);
  });

  it("rejects page-side exceptions from raw runtime evaluations", async () => {
    const conn = connection({
      Runtime: {
        evaluate: mock(async () => ({
          result: {},
          exceptionDetails: {
            text: "Uncaught",
            exception: { description: "Error: runtime blocked" },
          },
        })),
      } as unknown as CDPConnection["Runtime"],
    });

    await expect(scroll(conn, "down", 100)).rejects.toThrow(
      "Error: runtime blocked"
    );
    await expect(waitForStable(conn, 20)).rejects.toThrow(
      "Error: runtime blocked"
    );
  });

  it("resolves an action node once and always releases it", async () => {
    const resolveNode = mock(async () => ({ object: { objectId: "remote-7" } }));
    const releaseObject = mock(async () => ({}));
    const callFunctionOn = mock(async () => {
      throw new Error("page rejected click");
    });
    const conn = connection({
      DOM: { resolveNode } as unknown as CDPConnection["DOM"],
      Runtime: {
        callFunctionOn,
        releaseObject,
      } as unknown as CDPConnection["Runtime"],
    });

    await expect(clickNode(conn, 7)).rejects.toThrow("page rejected click");
    expect(resolveNode).toHaveBeenCalledTimes(1);
    expect(callFunctionOn).toHaveBeenCalledTimes(1);
    expect(releaseObject).toHaveBeenCalledWith({ objectId: "remote-7" });
  });

  it("does not turn cleanup failure into a failed committed action", async () => {
    const releaseError = new Error("release failed");
    const conn = connection({
      Runtime: {
        callFunctionOn: mock(async () => ({ result: { value: true } })),
        releaseObject: mock(async () => {
          throw releaseError;
        }),
      } as unknown as CDPConnection["Runtime"],
    });

    await expect(clickNode(conn, 7)).resolves.toBeUndefined();
  });

  it("accepts a successful navigating click after its remote context is gone", async () => {
    const conn = connection({
      Runtime: {
        callFunctionOn: mock(async () => ({ result: { value: true } })),
        releaseObject: mock(async () => {
          throw new Error("Cannot find context with specified id");
        }),
      } as unknown as CDPConnection["Runtime"],
    });

    await expect(clickNode(conn, 7)).resolves.toBeUndefined();
  });

  it("keeps an action failure primary when object release also fails", async () => {
    const actionError = new Error("click failed");
    const callFunctionOn = mock(async () => {
      throw actionError;
    });
    const conn = connection({
      Runtime: {
        callFunctionOn,
        releaseObject: mock(async () => {
          throw new Error("release failed");
        }),
      } as unknown as CDPConnection["Runtime"],
    });

    await expect(clickNode(conn, 7)).rejects.toBe(actionError);
  });

  it("clears and types into contenteditable textboxes", async () => {
    const events: string[] = [];
    const selection = {
      removeAllRanges: mock(() => {}),
      addRange: mock(() => {}),
    };
    const target: Record<string, unknown> = {
      isConnected: true,
      tagName: "DIV",
      isContentEditable: true,
      textContent: "old value",
      focus: mock(() => {}),
      dispatchEvent: (event: Event) => {
        events.push(event.type);
        return true;
      },
      getAttribute: mock(() => null),
      ownerDocument: {
        getSelection: () => selection,
        createRange: () => ({
          selectNodeContents: mock(() => {}),
          collapse: mock(() => {}),
        }),
      },
    };
    const conn = connectionForPageObject(target);

    await typeText(conn, 7, "new value", true);

    expect(target.textContent).toBe("new value");
    expect(events).toEqual(["input"]);
    expect(selection.removeAllRanges).not.toHaveBeenCalled();
    expect(selection.addRange).not.toHaveBeenCalled();
  });

  it("emits one input event when clearing without replacement text", async () => {
    const events: string[] = [];
    const target: Record<string, unknown> = {
      isConnected: true,
      tagName: "INPUT",
      type: "text",
      value: "old value",
      focus: mock(() => {}),
      getAttribute: mock(() => null),
      dispatchEvent: (event: Event) => {
        events.push(event.type);
        return true;
      },
    };
    const conn = connectionForPageObject(target);

    await typeText(conn, 7, "", true);

    expect(target.value).toBe("");
    expect(events).toEqual(["input"]);
  });

  it("types into non-selection inputs and enforces maxlength", async () => {
    const email = {
      isConnected: true,
      tagName: "INPUT",
      type: "email",
      value: "",
      selectionStart: null,
      maxLength: 5,
      setSelectionRange: mock(() => {
        throw new Error("unsupported selection");
      }),
      getAttribute: mock(() => null),
      dispatchEvent: mock(() => true),
    };

    await typeText(connectionForPageObject(email), 7, "abcdef");

    expect(email.value).toBe("abcde");
    expect(email.setSelectionRange).not.toHaveBeenCalled();

    email.value = "";
    email.maxLength = 1;
    await typeText(connectionForPageObject(email), 7, "😀");
    expect(email.value).toBe("");
  });

  it("rejects role textboxes that are not actually editable", async () => {
    const target: Record<string, unknown> = {
      isConnected: true,
      tagName: "DIV",
      isContentEditable: false,
      focus: mock(() => {}),
      getAttribute: mock(() => "textbox"),
    };
    const conn = connectionForPageObject(target);

    await expect(typeText(conn, 7, "ignored")).rejects.toThrow(
      "not a text-editable input"
    );
    expect(target.focus).not.toHaveBeenCalled();
  });

  it("selects only existing options on native selects", async () => {
    const events: string[] = [];
    const target: Record<string, unknown> = {
      isConnected: true,
      tagName: "SELECT",
      disabled: false,
      value: "first",
      options: [
        { value: "first", matches: () => false },
        { value: "second", matches: () => false },
        { value: "disabled", matches: () => true },
      ],
      getAttribute: mock(() => null),
      dispatchEvent: (event: Event) => {
        events.push(event.type);
        return true;
      },
    };
    const conn = connectionForPageObject(target);

    await selectOption(conn, 7, "second");
    expect(target.value).toBe("second");
    expect(events).toEqual(["input", "change"]);

    await expect(selectOption(conn, 7, "missing")).rejects.toThrow(
      "Select option does not exist"
    );
    await expect(selectOption(conn, 7, "disabled")).rejects.toThrow(
      "Select option is disabled"
    );
    expect(target.value).toBe("second");
  });

  it("rejects custom ARIA listboxes that cannot use native selection", async () => {
    const target: Record<string, unknown> = {
      isConnected: true,
      tagName: "DIV",
      options: [],
      getAttribute: mock(() => "listbox"),
    };
    const conn = connectionForPageObject(target);

    await expect(selectOption(conn, 7, "value")).rejects.toThrow(
      "not a native select"
    );
  });

  it("rejects page-side action exceptions returned by CDP", async () => {
    const releaseObject = mock(async () => ({}));
    const callFunctionOn = mock(async () => ({
      exceptionDetails: {
        text: "Uncaught",
        exception: { description: "Error: click blocked" },
      },
    }));
    const conn = connection({
      Runtime: {
        callFunctionOn,
        releaseObject,
      } as unknown as CDPConnection["Runtime"],
    });

    await expect(clickNode(conn, 7)).rejects.toThrow("Error: click blocked");
    expect(releaseObject).toHaveBeenCalledWith({ objectId: "object-1" });
  });

  it("preserves a resolveNode protocol error", async () => {
    const protocolError = new Error("No node with given id found");
    const conn = connection({
      DOM: {
        resolveNode: mock(async () => {
          throw protocolError;
        }),
      } as unknown as CDPConnection["DOM"],
    });

    await expect(clickNode(conn, 99)).rejects.toBe(protocolError);
  });

  it("registers the load listener before sending navigation", async () => {
    const order: string[] = [];
    const conn = connection({
      Page: {
        lifecycleEvent: mock(() => {
          order.push("listen");
          return () => {};
        }),
        navigate: mock(async () => {
          order.push("navigate");
          return {};
        }),
      } as unknown as CDPConnection["Page"],
    });

    await navigate(conn, "https://example.com");
    expect(order).toEqual(["listen", "navigate"]);
  });

  it("waits for the matching loader and unsubscribes after navigation", async () => {
    const unsubscribe = mock(() => {});
    let lifecycle!: (event: { name: string; loaderId: string }) => void;
    const conn = connection({
      Page: {
        lifecycleEvent: mock((handler: typeof lifecycle) => {
          lifecycle = handler;
          return unsubscribe;
        }),
        navigate: mock(async () => {
          queueMicrotask(() => {
            lifecycle({ name: "load", loaderId: "other-loader" });
            lifecycle({ name: "load", loaderId: "loader-1" });
          });
          return { loaderId: "loader-1" };
        }),
      } as unknown as CDPConnection["Page"],
    });

    await navigate(conn, "https://example.com");

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("resolves an upload target once and releases it", async () => {
    const resolveNode = mock(async () => ({ object: { objectId: "upload-1" } }));
    const setFileInputFiles = mock(async () => {});
    const callFunctionOn = mock(async () => ({}));
    const releaseObject = mock(async () => {});
    const conn = connection({
      DOM: {
        resolveNode,
        setFileInputFiles,
      } as unknown as CDPConnection["DOM"],
      Runtime: {
        callFunctionOn,
        releaseObject,
      } as unknown as CDPConnection["Runtime"],
    });

    await setFileInput(conn, 17, ["/tmp/file.txt"]);

    expect(resolveNode).toHaveBeenCalledTimes(1);
    expect(setFileInputFiles).toHaveBeenCalledWith({
      files: ["/tmp/file.txt"],
      objectId: "upload-1",
    });
    expect(callFunctionOn).not.toHaveBeenCalled();
    expect(releaseObject).toHaveBeenCalledWith({ objectId: "upload-1" });
  });

  it("wraps browser navigation errors", async () => {
    const conn = connection({
      Page: {
        lifecycleEvent: mock(() => () => {}),
        navigate: mock(async () => ({ errorText: "blocked" })),
      } as unknown as CDPConnection["Page"],
    });

    await expect(navigate(conn, "https://example.com")).rejects.toBeInstanceOf(
      NavigationError
    );
  });

  it("runs concurrent stability waits independently", async () => {
    const sharedWindow: Record<string, unknown> = {};
    class Observer {
      observe() {}
      disconnect() {}
    }
    const runtimeEvaluate = mock(async ({ expression }: { expression: string }) => {
      const execute = new Function(
        "MutationObserver",
        "document",
        "window",
        `return (${expression})`
      ) as (
        observer: typeof Observer,
        document: { body: object },
        window: Record<string, unknown>
      ) => Promise<void>;
      await execute(Observer, { body: {} }, sharedWindow);
      return { result: { value: undefined } };
    });
    const conn = connection({
      Runtime: { evaluate: runtimeEvaluate } as unknown as CDPConnection["Runtime"],
    });

    await Promise.all([waitForStable(conn, 20), waitForStable(conn, 20)]);
    expect(runtimeEvaluate).toHaveBeenCalledTimes(2);
  });

  it("rejects an evaluation with no result object", async () => {
    const conn = connection({
      Runtime: {
        evaluate: mock(async () => ({})),
      } as unknown as CDPConnection["Runtime"],
    });

    await expect(evaluate(conn, "1 + 1")).rejects.toThrow("no result");
  });

  it("rejects oversized screenshots before asking Chrome to encode them", async () => {
    const capture = mock(async () => ({ data: "" }));
    const conn = connection({
      Page: { captureScreenshot: capture } as unknown as CDPConnection["Page"],
    });

    await expect(captureScreenshot(conn, {
      clip: { x: 0, y: 0, width: 20_000, height: 20_000, scale: 1 },
      fullPage: true,
    })).rejects.toBeInstanceOf(ValidationError);
    expect(capture).not.toHaveBeenCalled();
  });

  it("returns CDP unserializable values without breaking JSON adapters", async () => {
    const conn = connection({
      Runtime: {
        evaluate: mock(async () => ({
          result: { unserializableValue: "9007199254740993n" },
        })),
      } as unknown as CDPConnection["Runtime"],
    });

    await expect(evaluate(conn, "9007199254740993n")).resolves.toBe(
      "9007199254740993n"
    );
  });

  it("does not grant clipboard permissions after an origin timeout", async () => {
    let resolveOrigin!: (value: unknown) => void;
    const origin = new Promise((resolve) => {
      resolveOrigin = resolve;
    });
    const send = mock(async () => ({}));
    const conn = connection({
      client: { send } as unknown as CDPConnection["client"],
      Runtime: {
        evaluate: mock(() => origin),
      } as unknown as CDPConnection["Runtime"],
    });

    await expect(clipboardWrite(conn, "text", 5)).rejects.toBeInstanceOf(
      CDPTimeoutError
    );
    resolveOrigin({ result: { value: "https://example.com" } });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(send).not.toHaveBeenCalled();
  });

  it("resets permissions again when a timed-out grant completes late", async () => {
    let resolveGrant!: () => void;
    const grant = new Promise<void>((resolve) => { resolveGrant = resolve; });
    const send = mock(async (method: string) => {
      if (method === "Browser.grantPermissions") return grant;
      return {};
    });
    const conn = connection({
      client: { send } as unknown as CDPConnection["client"],
      Runtime: {
        evaluate: mock(async () => ({
          result: { value: "https://example.com" },
        })),
      } as unknown as CDPConnection["Runtime"],
    });

    await expect(clipboardWrite(conn, "text", 5)).rejects.toBeInstanceOf(
      CDPTimeoutError
    );
    expect(send.mock.calls.filter(([method]) =>
      method === "Browser.resetPermissions"
    )).toHaveLength(1);

    resolveGrant();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(send.mock.calls.filter(([method]) =>
      method === "Browser.resetPermissions"
    )).toHaveLength(2);
  });

  it("resets temporary clipboard permissions after writing", async () => {
    const send = mock(async () => ({}));
    const evaluate = mock(async ({ expression }: { expression: string }) => ({
      result: {
        value: expression === "location.origin"
          ? "https://example.com"
          : undefined,
      },
    }));
    const conn = connection({
      client: { send } as unknown as CDPConnection["client"],
      Runtime: { evaluate } as unknown as CDPConnection["Runtime"],
    });

    await clipboardWrite(conn, "text");

    expect(send.mock.calls.map(([method]) => method)).toEqual([
      "Browser.grantPermissions",
      "Page.bringToFront",
      "Browser.resetPermissions",
    ]);
  });

  it("keeps a clipboard failure primary when permission reset also fails", async () => {
    const writeError = new Error("clipboard write failed");
    const send = mock(async (method: string) => {
      if (method === "Browser.resetPermissions") throw new Error("reset failed");
      return {};
    });
    const conn = connection({
      client: { send } as unknown as CDPConnection["client"],
      Runtime: {
        evaluate: mock(async ({ expression }: { expression: string }) => {
          if (expression === "location.origin") {
            return { result: { value: "https://example.com" } };
          }
          throw writeError;
        }),
      } as unknown as CDPConnection["Runtime"],
    });

    await expect(clipboardWrite(conn, "text")).rejects.toBe(writeError);
    expect(send).toHaveBeenLastCalledWith("Browser.resetPermissions");
  });

  it("disconnects without extra domain round trips", async () => {
    const close = mock(async () => {});
    const disable = mock(async () => {});
    const conn = connection({
      client: { close } as unknown as CDPConnection["client"],
      DOM: { disable } as unknown as CDPConnection["DOM"],
      Page: { disable } as unknown as CDPConnection["Page"],
      Runtime: { disable } as unknown as CDPConnection["Runtime"],
    });

    await disconnect(conn);
    expect(close).toHaveBeenCalledTimes(1);
    expect(disable).not.toHaveBeenCalled();
  });
});

describe("download listeners", () => {
  function downloadConnection() {
    const handlers = new Map<string, (params: never) => void>();
    const removed: string[] = [];
    const conn = connection({
      Page: {
        setDownloadBehavior: mock(async () => ({})),
        on: mock((event: string, handler: (params: never) => void) => {
          handlers.set(event, handler);
          return () => {
            removed.push(event);
            handlers.delete(event);
          };
        }),
      } as unknown as CDPConnection["Page"],
    });
    return { conn, handlers, removed };
  }

  it("buffers completion until filename metadata arrives", async () => {
    const { conn, handlers, removed } = downloadConnection();
    const download = downloadFromAction(
      conn,
      { downloadDir: "/tmp/downloads", timeout: 100 },
      async () => {
        handlers.get("downloadProgress")?.({
          guid: "fast-1",
          state: "completed",
          totalBytes: 42,
        } as never);
        handlers.get("downloadWillBegin")?.({
          guid: "fast-1",
          suggestedFilename: "report.txt",
          url: "https://example.com/report.txt",
        } as never);
      }
    );

    await expect(download).resolves.toEqual({
      filePath: "/tmp/downloads/report.txt",
      fileName: "report.txt",
      totalBytes: 42,
    });
    expect(removed).toContain("downloadWillBegin");
    expect(removed).toContain("downloadProgress");
  });

  it("rejects overlapping downloads before reconfiguring the directory", async () => {
    const { conn, handlers } = downloadConnection();
    let release!: () => void;
    const first = downloadFromAction(
      conn,
      { downloadDir: "/tmp/downloads", timeout: 100 },
      async () => {
        await new Promise<void>((resolveTrigger) => { release = resolveTrigger; });
        handlers.get("downloadWillBegin")?.({
          guid: "first",
          suggestedFilename: "first.txt",
        } as never);
        handlers.get("downloadProgress")?.({
          guid: "first",
          state: "completed",
        } as never);
      }
    );
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 0));

    await expect(
      downloadFromAction(conn, { downloadDir: "/tmp/other" }, async () => {})
    ).rejects.toBeInstanceOf(ValidationError);
    release();
    await expect(first).resolves.toMatchObject({ fileName: "first.txt" });
  });

  it("cleans up listeners after a timeout", async () => {
    const { conn, removed } = downloadConnection();
    await expect(
      downloadFromAction(
        conn,
        { downloadDir: "/tmp/downloads", timeout: 5 },
        async () => {}
      )
    ).rejects.toBeInstanceOf(CDPTimeoutError);
    expect(removed).toHaveLength(2);
  });

  it("does not reset download behavior when directory setup fails", async () => {
    const { conn } = downloadConnection();

    await expect(
      downloadFromAction(conn, { downloadDir: "\0" }, async () => {})
    ).rejects.toThrow();

    expect(conn.Page.setDownloadBehavior).not.toHaveBeenCalled();
  });
});
