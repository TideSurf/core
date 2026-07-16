import { describe, expect, it, mock } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clickNode,
  captureScreenshot,
  clipboardRead,
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
import {
  ActionCommittedError,
  CDPTimeoutError,
  NavigationError,
  ValidationError,
} from "../../src/errors.js";

function connection(overrides: Partial<CDPConnection> = {}): CDPConnection {
  return {
    client: Object.assign(new EventEmitter(), {
      close: mock(async () => {}),
      send: mock(async () => ({})),
    }) as unknown as CDPConnection["client"],
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
    Emulation: {} as CDPConnection["Emulation"],
    disconnected: false,
    ownsBrowser: true,
    ...overrides,
  };
}

function connectionForPageObject(
  target: Record<string, unknown>
): CDPConnection {
  target.matches ??= () => false;
  target.closest ??= () => null;
  target.contains ??= () => false;
  target.focus ??= () => {};
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
  it("does not invite a retry when a scroll response times out", async () => {
    const conn = connection({
      Runtime: {
        evaluate: mock(() => new Promise(() => {})),
      } as unknown as CDPConnection["Runtime"],
    });

    await expect(scroll(conn, "down", 100, 5)).rejects.toMatchObject({
      name: "ActionCommittedError",
      message: expect.stringContaining("may have completed"),
    });
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

  it("keeps element resolution timeouts retryable before mutation starts", async () => {
    const callFunctionOn = mock(async () => ({ result: { value: true } }));
    const conn = connection({
      DOM: {
        resolveNode: mock(() => new Promise(() => {})),
      } as unknown as CDPConnection["DOM"],
      Runtime: {
        callFunctionOn,
        releaseObject: mock(async () => ({})),
      } as unknown as CDPConnection["Runtime"],
    });

    await expect(clickNode(conn, 7, 5)).rejects.toBeInstanceOf(CDPTimeoutError);
    expect(callFunctionOn).not.toHaveBeenCalled();
  });

  it("does not invite a retry when an element mutation response times out", async () => {
    const conn = connection({
      Runtime: {
        callFunctionOn: mock(() => new Promise(() => {})),
        releaseObject: mock(async () => ({})),
      } as unknown as CDPConnection["Runtime"],
    });

    await expect(clickNode(conn, 7, 5)).rejects.toMatchObject({
      name: "ActionCommittedError",
      message: expect.stringContaining("Click may have completed"),
    });
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
    expect(events).toEqual(["input", "change"]);
    expect(selection.removeAllRanges).not.toHaveBeenCalled();
    expect(selection.addRange).not.toHaveBeenCalled();
  });

  it("emits one input/change pair when clearing without replacement text", async () => {
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
    expect(events).toEqual(["input", "change"]);
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

  it("focuses the target and dispatches input then change", async () => {
    const events: string[] = [];
    const target: Record<string, unknown> = {
      isConnected: true,
      tagName: "INPUT",
      type: "text",
      value: "",
      focus: () => {
        events.push("focus");
      },
      getAttribute: mock(() => null),
      dispatchEvent: (event: Event) => {
        events.push(event.type);
        return true;
      },
    };
    const conn = connectionForPageObject(target);

    await typeText(conn, 7, "hello");

    expect(target.value).toBe("hello");
    expect(events).toEqual(["focus", "input", "change"]);
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

  it("shares one byte-identical interaction guard across injected actions", async () => {
    const declarations: string[] = [];
    const capture = () => connection({
      Runtime: {
        callFunctionOn: mock(async (params: { functionDeclaration: string }) => {
          declarations.push(params.functionDeclaration);
          return { result: { value: true } };
        }),
        releaseObject: mock(async () => ({})),
      } as unknown as CDPConnection["Runtime"],
    });

    await clickNode(capture(), 7);
    await typeText(capture(), 7, "text");
    await selectOption(capture(), 7, "value");

    const guard = (source: string) => source.slice(
      source.indexOf("const ariaDisabled"),
      source.indexOf("if (this.matches")
    );
    expect(declarations).toHaveLength(3);
    expect(guard(declarations[0])).toContain("pointerEvents === 'none'");
    expect(guard(declarations[1])).toBe(guard(declarations[0]));
    expect(guard(declarations[2])).toBe(guard(declarations[0]));
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
        on: mock(() => () => {}),
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
        on: mock(() => () => {}),
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

  function redirectHarness(
    schedule: (
      frameNavigated: (event: { frame: { id: string; loaderId: string } }) => void,
      lifecycle: (event: { name: string; loaderId: string }) => void
    ) => void
  ): CDPConnection {
    let lifecycle!: (event: { name: string; loaderId: string }) => void;
    let frameNavigated!: (event: {
      frame: { id: string; loaderId: string };
    }) => void;
    return connection({
      Page: {
        lifecycleEvent: mock((handler: typeof lifecycle) => {
          lifecycle = handler;
          return () => {};
        }),
        on: mock((_event: string, handler: typeof frameNavigated) => {
          frameNavigated = handler;
          return () => {};
        }),
        navigate: mock(async () => {
          schedule(
            (event) => frameNavigated(event),
            (event) => lifecycle(event)
          );
          return { frameId: "frame-1", loaderId: "loader-1" };
        }),
      } as unknown as CDPConnection["Page"],
    });
  }

  it("resolves when a client-side redirect replaces the pending loader", async () => {
    const conn = redirectHarness((frameNavigated, lifecycle) => {
      setTimeout(() => {
        frameNavigated({ frame: { id: "frame-1", loaderId: "loader-1" } });
        frameNavigated({ frame: { id: "frame-1", loaderId: "loader-2" } });
        lifecycle({ name: "load", loaderId: "loader-2" });
      }, 0);
    });

    const started = Date.now();
    await navigate(conn, "https://example.com", 5_000);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("resolves a redirect whose events all arrive before the navigate reply", async () => {
    const conn = redirectHarness((frameNavigated, lifecycle) => {
      frameNavigated({ frame: { id: "frame-1", loaderId: "loader-1" } });
      frameNavigated({ frame: { id: "frame-1", loaderId: "loader-2" } });
      lifecycle({ name: "load", loaderId: "loader-2" });
    });

    const started = Date.now();
    await navigate(conn, "https://example.com", 5_000);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("does not accept a load from a loader that committed before ours", async () => {
    const conn = redirectHarness((frameNavigated, lifecycle) => {
      setTimeout(() => {
        frameNavigated({ frame: { id: "frame-1", loaderId: "loader-0" } });
        lifecycle({ name: "load", loaderId: "loader-0" });
        frameNavigated({ frame: { id: "frame-1", loaderId: "loader-1" } });
      }, 0);
    });

    await expect(
      navigate(conn, "https://example.com", 50)
    ).rejects.toBeInstanceOf(ActionCommittedError);
  });

  it("does not accept a subframe loader as a navigation successor", async () => {
    const conn = redirectHarness((frameNavigated, lifecycle) => {
      setTimeout(() => {
        frameNavigated({ frame: { id: "frame-1", loaderId: "loader-1" } });
        frameNavigated({ frame: { id: "child-frame", loaderId: "iframe-loader" } });
        lifecycle({ name: "load", loaderId: "iframe-loader" });
      }, 0);
    });

    await expect(
      navigate(conn, "https://example.com", 50)
    ).rejects.toBeInstanceOf(ActionCommittedError);
  });

  it("stops a committed navigation when the target disconnects", async () => {
    const client = Object.assign(new EventEmitter(), {
      close: mock(async () => {}),
      send: mock(async () => ({})),
    });
    const unsubscribe = mock(() => {});
    const conn = connection({
      client: client as unknown as CDPConnection["client"],
      Page: {
        lifecycleEvent: mock(() => unsubscribe),
        on: mock(() => () => {}),
        navigate: mock(async () => ({ loaderId: "loader-1" })),
      } as unknown as CDPConnection["Page"],
    });
    const started = Date.now();
    const pending = navigate(conn, "https://example.com", 5_000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    client.emit("disconnect");

    await expect(pending).rejects.toBeInstanceOf(ActionCommittedError);
    expect(Date.now() - started).toBeLessThan(500);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(client.listenerCount("disconnect")).toBe(0);
  });

  it("does not invite a retry when navigation disconnects before its reply", async () => {
    const client = Object.assign(new EventEmitter(), {
      close: mock(async () => {}),
      send: mock(async () => ({})),
    });
    const conn = connection({
      client: client as unknown as CDPConnection["client"],
      Page: {
        lifecycleEvent: mock(() => () => {}),
        on: mock(() => () => {}),
        navigate: mock(() => new Promise(() => {})),
      } as unknown as CDPConnection["Page"],
    });

    const pending = navigate(conn, "https://example.com", 5_000);
    await Promise.resolve();
    client.emit("disconnect");

    await expect(pending).rejects.toMatchObject({
      name: "ActionCommittedError",
      message: expect.stringContaining("may have completed"),
    });
    expect(client.listenerCount("disconnect")).toBe(0);
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
        on: mock(() => () => {}),
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

  it("observes the document root so body replacement stays visible", async () => {
    const documentElement = {};
    let observed: object | undefined;
    class Observer {
      observe(target: object) {
        observed = target;
      }
      disconnect() {}
    }
    const runtimeEvaluate = mock(async ({ expression }: { expression: string }) => {
      const execute = new Function(
        "MutationObserver",
        "document",
        `return (${expression})`
      ) as (
        observer: typeof Observer,
        document: { documentElement: object; body: object }
      ) => Promise<void>;
      await execute(Observer, { documentElement, body: {} });
      return { result: { value: undefined } };
    });
    const conn = connection({
      Runtime: { evaluate: runtimeEvaluate } as unknown as CDPConnection["Runtime"],
    });

    await waitForStable(conn, 1);

    expect(observed).toBe(documentElement);
  });

  it("keeps the maximum supported stability timeout within timer bounds", async () => {
    const runtimeEvaluate = mock(async () => ({ result: { value: undefined } }));
    const conn = connection({
      Runtime: { evaluate: runtimeEvaluate } as unknown as CDPConnection["Runtime"],
    });

    await waitForStable(conn, 2_147_483_647);

    expect(runtimeEvaluate).toHaveBeenCalledTimes(1);
    expect(runtimeEvaluate.mock.calls[0][0].expression).toContain(
      "hardTimer = setTimeout(done, 2147483397)"
    );
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

  it("captures clipped screenshots beyond the current viewport", async () => {
    const capture = mock(async () => ({ data: "png" }));
    const conn = connection({
      Page: { captureScreenshot: capture } as unknown as CDPConnection["Page"],
    });
    const clip = { x: 20, y: 2_000, width: 120, height: 60, scale: 1 };

    await captureScreenshot(conn, { clip });

    expect(capture).toHaveBeenCalledWith({
      format: "png",
      clip,
      captureBeyondViewport: true,
    });
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
      client: Object.assign(new EventEmitter(), { send }) as unknown as CDPConnection["client"],
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
      client: Object.assign(new EventEmitter(), { send }) as unknown as CDPConnection["client"],
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

  it("queues a late permission reset behind the next clipboard operation", async () => {
    let resolveLateGrant!: () => void;
    const lateGrant = new Promise<void>((resolve) => {
      resolveLateGrant = resolve;
    });
    let releaseWrite!: () => void;
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    let signalWriteStarted!: () => void;
    const writeStarted = new Promise<void>((resolve) => {
      signalWriteStarted = resolve;
    });
    const events: string[] = [];
    let grantCount = 0;
    const send = mock(async (method: string) => {
      events.push(method);
      if (method === "Browser.grantPermissions" && grantCount++ === 0) {
        return lateGrant;
      }
      return {};
    });
    const conn = connection({
      client: Object.assign(new EventEmitter(), { send }) as unknown as CDPConnection["client"],
      Runtime: {
        evaluate: mock(async ({ expression }: { expression: string }) => {
          if (expression === "location.origin") {
            return { result: { value: "https://example.com" } };
          }
          events.push("write:start");
          signalWriteStarted();
          await writeGate;
          events.push("write:end");
          return { result: { value: undefined } };
        }),
      } as unknown as CDPConnection["Runtime"],
    });

    await expect(clipboardWrite(conn, "first", 5)).rejects.toBeInstanceOf(
      CDPTimeoutError
    );
    const second = clipboardWrite(conn, "second", 100);
    await writeStarted;
    resolveLateGrant();
    await Promise.resolve();
    await Promise.resolve();

    expect(events.slice(events.indexOf("write:start"))).toEqual(["write:start"]);

    releaseWrite();
    await second;
    await new Promise((resolve) => setTimeout(resolve, 0));

    const writeStart = events.indexOf("write:start");
    const writeEnd = events.indexOf("write:end");
    expect(events.slice(writeStart, writeEnd + 1)).toEqual([
      "write:start",
      "write:end",
    ]);
    expect(events.filter((event) => event === "Browser.resetPermissions")).toHaveLength(3);
  });

  it("keeps later clipboard work behind a timed-out permission reset", async () => {
    let resolveReset!: () => void;
    const lateReset = new Promise<void>((resolve) => {
      resolveReset = resolve;
    });
    const events: string[] = [];
    let resetCount = 0;
    const send = mock(async (method: string) => {
      events.push(method);
      if (method === "Browser.resetPermissions" && resetCount++ === 0) {
        return lateReset;
      }
      return {};
    });
    const conn = connection({
      client: Object.assign(new EventEmitter(), { send }) as unknown as CDPConnection["client"],
      Runtime: {
        evaluate: mock(async ({ expression }: { expression: string }) => ({
          result: {
            value: expression === "location.origin"
              ? "https://example.com"
              : undefined,
          },
        })),
      } as unknown as CDPConnection["Runtime"],
    });

    await expect(clipboardWrite(conn, "first", 5)).rejects.toBeInstanceOf(
      ActionCommittedError
    );
    const second = clipboardWrite(conn, "second", 100);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events.filter((event) => event === "Browser.grantPermissions")).toHaveLength(1);

    resolveReset();
    await second;
    expect(events.filter((event) => event === "Browser.grantPermissions")).toHaveLength(2);
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
      client: Object.assign(new EventEmitter(), { send }) as unknown as CDPConnection["client"],
      Runtime: { evaluate } as unknown as CDPConnection["Runtime"],
    });

    await clipboardWrite(conn, "text");

    expect(send.mock.calls.map(([method]) => method)).toEqual([
      "Browser.grantPermissions",
      "Page.bringToFront",
      "Browser.resetPermissions",
    ]);
  });

  it("leaves permission overrides alone on a browser TideSurf did not launch", async () => {
    const send = mock(async () => ({}));
    const evaluate = mock(async ({ expression }: { expression: string }) => ({
      result: {
        value: expression === "location.origin"
          ? "https://example.com"
          : undefined,
      },
    }));
    const conn = connection({
      ownsBrowser: false,
      client: Object.assign(new EventEmitter(), { send }) as unknown as CDPConnection["client"],
      Runtime: { evaluate } as unknown as CDPConnection["Runtime"],
    });

    await clipboardWrite(conn, "text");

    expect(send.mock.calls.map(([method]) => method)).toEqual([
      "Browser.grantPermissions",
      "Page.bringToFront",
    ]);
  });

  it("skips the deferred reset on an unowned browser when a grant completes late", async () => {
    let resolveGrant!: () => void;
    const grant = new Promise<void>((resolve) => { resolveGrant = resolve; });
    const send = mock(async (method: string) => {
      if (method === "Browser.grantPermissions") return grant;
      return {};
    });
    const conn = connection({
      ownsBrowser: false,
      client: Object.assign(new EventEmitter(), { send }) as unknown as CDPConnection["client"],
      Runtime: {
        evaluate: mock(async () => ({
          result: { value: "https://example.com" },
        })),
      } as unknown as CDPConnection["Runtime"],
    });

    await expect(clipboardWrite(conn, "text", 5)).rejects.toBeInstanceOf(
      CDPTimeoutError
    );
    resolveGrant();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(send.mock.calls.filter(([method]) =>
      method === "Browser.resetPermissions"
    )).toHaveLength(0);
  });

  it("keeps clipboard cooldowns independent across browser connections", async () => {
    const clipboardConnection = () => connection({
      Runtime: {
        evaluate: mock(async ({ expression }: { expression: string }) => ({
          result: {
            value: expression === "location.origin"
              ? "https://example.com"
              : "clipboard",
          },
        })),
      } as unknown as CDPConnection["Runtime"],
    });
    const first = clipboardConnection();
    const second = clipboardConnection();

    await expect(clipboardRead(first)).resolves.toBe("clipboard");
    await expect(clipboardRead(second)).resolves.toBe("clipboard");
    await expect(clipboardRead(first)).rejects.toThrow("rate limit exceeded");
  });

  it("does not serialize clipboard writes from independent browsers", async () => {
    let active = 0;
    let peak = 0;
    const clipboardConnection = () => connection({
      Runtime: {
        evaluate: mock(async ({ expression }: { expression: string }) => {
          if (expression === "location.origin") {
            return { result: { value: "https://example.com" } };
          }
          active++;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 10));
          active--;
          return { result: { value: undefined } };
        }),
      } as unknown as CDPConnection["Runtime"],
    });

    await Promise.all([
      clipboardWrite(clipboardConnection(), "first"),
      clipboardWrite(clipboardConnection(), "second"),
    ]);

    expect(peak).toBe(2);
  });

  it("keeps a clipboard failure primary when permission reset also fails", async () => {
    const writeError = new Error("clipboard write failed");
    const send = mock(async (method: string) => {
      if (method === "Browser.resetPermissions") throw new Error("reset failed");
      return {};
    });
    const conn = connection({
      client: Object.assign(new EventEmitter(), { send }) as unknown as CDPConnection["client"],
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
    const client = Object.assign(new EventEmitter(), {
      close: mock(async () => {}),
      send: mock(async () => ({})),
    });
    const conn = connection({
      client: client as unknown as CDPConnection["client"],
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
    return { conn, handlers, removed, client };
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

  it("cleans up listeners after a committed download times out", async () => {
    const { conn, removed } = downloadConnection();
    await expect(
      downloadFromAction(
        conn,
        { downloadDir: "/tmp/downloads", timeout: 5 },
        async () => {}
      )
    ).rejects.toBeInstanceOf(ActionCommittedError);
    expect(removed).toHaveLength(2);
  });

  it("reports an ambiguous trigger disconnect without inviting a retry", async () => {
    const { conn, client } = downloadConnection();
    const started = Date.now();

    await expect(
      downloadFromAction(
        conn,
        { downloadDir: "/tmp/downloads", timeout: 10_000 },
        async () => {
          client.emit("disconnect");
          await new Promise(() => {});
        }
      )
    ).rejects.toMatchObject({
      name: "ActionCommittedError",
      message: expect.stringContaining("may have completed"),
    });

    expect(Date.now() - started).toBeLessThan(500);
    expect(client.listenerCount("disconnect")).toBe(0);
    await expect(
      downloadFromAction(
        conn,
        { downloadDir: "/tmp/downloads", timeout: 5 },
        async () => {}
      )
    ).rejects.toBeInstanceOf(ActionCommittedError);
  });

  it("does not reset download behavior when directory setup fails", async () => {
    const { conn } = downloadConnection();

    await expect(
      downloadFromAction(conn, { downloadDir: "\0" }, async () => {})
    ).rejects.toThrow();

    expect(conn.Page.setDownloadBehavior).not.toHaveBeenCalled();
  });

  it("revalidates a download directory immediately before setup", async () => {
    if (process.platform === "win32") return;

    const allowedRoot = await mkdtemp(join(tmpdir(), "tidesurf-allowed-"));
    const outsideRoot = await mkdtemp(join(tmpdir(), "tidesurf-outside-"));
    const redirected = join(allowedRoot, "redirected");
    const requested = join(redirected, "downloads");
    await symlink(outsideRoot, redirected, "dir");
    const { conn } = downloadConnection();

    try {
      await expect(
        downloadFromAction(
          conn,
          {
            downloadDir: requested,
            fileAccessRoots: [allowedRoot],
          },
          async () => {}
        )
      ).rejects.toBeInstanceOf(ValidationError);
      expect(conn.Page.setDownloadBehavior).not.toHaveBeenCalled();
      await expect(stat(join(outsideRoot, "downloads"))).rejects.toThrow();
    } finally {
      await Promise.all([
        rm(allowedRoot, { recursive: true, force: true }),
        rm(outsideRoot, { recursive: true, force: true }),
      ]);
    }
  });
});
