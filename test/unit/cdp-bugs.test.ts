import { describe, expect, it, mock } from "bun:test";
import {
  clickNode,
  clipboardWrite,
  disconnect,
  evaluate,
  getFullDOM,
  navigate,
  selectOption,
  setFileInput,
  scroll,
  typeText,
  waitForStable,
  type CDPConnection,
} from "../../src/cdp/connection.js";
import { downloadFromAction } from "../../src/cdp/download-manager.js";
import { SurfingPage } from "../../src/cdp/page.js";
import { CDPTimeoutError, NavigationError, ValidationError } from "../../src/errors.js";

function connection(overrides: Partial<CDPConnection> = {}): CDPConnection {
  return {
    client: { close: mock(async () => {}) } as unknown as CDPConnection["client"],
    DOM: {
      resolveNode: mock(async () => ({ object: { objectId: "object-1" } })),
    } as unknown as CDPConnection["DOM"],
    Page: {
      navigate: mock(async () => ({})),
      loadEventFired: mock(async () => ({})),
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
  target: Record<string, unknown>,
  insertText: (text: string) => void = () => undefined
): CDPConnection {
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
    Input: {
      insertText: mock(async ({ text }: { text: string }) => insertText(text)),
    } as unknown as CDPConnection["Input"],
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

  it("uses a known composed element count without repeating the preflight", async () => {
    const runtimeEvaluate = mock(async () => {
      throw new Error("unexpected preflight");
    });
    const getDocument = mock(async () => ({
      root: {
        nodeId: 1,
        backendNodeId: 1,
        nodeType: 9,
        nodeName: "#document",
        localName: "",
        nodeValue: "",
        children: [],
      },
    }));
    const conn = connection({
      Runtime: { evaluate: runtimeEvaluate } as unknown as CDPConnection["Runtime"],
      DOM: { getDocument } as unknown as CDPConnection["DOM"],
    });

    await expect(getFullDOM(conn, 100, 0)).resolves.toMatchObject({
      nodeType: 9,
    });
    expect(runtimeEvaluate).not.toHaveBeenCalled();
    expect(getDocument).toHaveBeenCalledTimes(1);
  });

  it("bounds shadow DOM before requesting the protocol tree", async () => {
    const shadowChildren = Array.from({ length: 50_001 }, () => ({
      nodeType: 1,
      tagName: "SPAN",
      children: [],
      shadowRoot: null,
    }));
    const documentElement = {
      nodeType: 1,
      tagName: "HTML",
      children: [],
      shadowRoot: { nodeType: 11, children: shadowChildren },
    };
    const document = { nodeType: 9, documentElement };
    const runtimeEvaluate = mock(async ({ expression }: { expression: string }) => ({
      result: {
        value: new Function(
          "document",
          "Node",
          `return ${expression}`
        )(document, {
          DOCUMENT_NODE: 9,
          DOCUMENT_FRAGMENT_NODE: 11,
          ELEMENT_NODE: 1,
        }),
      },
    }));
    const getDocument = mock(async () => ({ root: {} }));
    const conn = connection({
      Runtime: { evaluate: runtimeEvaluate } as unknown as CDPConnection["Runtime"],
      DOM: { getDocument } as unknown as CDPConnection["DOM"],
    });

    await expect(getFullDOM(conn, 1_000)).rejects.toThrow(
      "DOM exceeds maximum node count"
    );
    expect(getDocument).not.toHaveBeenCalled();
  });

  it("caps page inspection before allocating or styling an oversized DOM", async () => {
    const children = Array.from({ length: 50_000 }, () => ({
      nodeType: 1,
      children: [],
    }));
    const documentElement = {
      nodeType: 1,
      tagName: "HTML",
      attributes: [],
      children,
      shadowRoot: null,
      scrollHeight: 100,
      removeAttribute: mock(() => {}),
    };
    const pageDocument = {
      nodeType: 9,
      documentElement,
      title: "Oversized",
    };
    const pageWindow = {
      scrollY: 0,
      innerHeight: 100,
    };
    const runtimeEvaluate = mock(async ({ expression }: { expression: string }) => ({
      result: {
        value: new Function(
          "location",
          "document",
          "window",
          "Node",
          `return ${expression}`
        )(
          { href: "https://example.com/" },
          pageDocument,
          pageWindow,
          { DOCUMENT_NODE: 9, DOCUMENT_FRAGMENT_NODE: 11, ELEMENT_NODE: 1 }
        ),
      },
    }));
    const getDocument = mock(async () => ({ root: {} }));
    const conn = connection({
      Runtime: { evaluate: runtimeEvaluate } as unknown as CDPConnection["Runtime"],
      DOM: { getDocument } as unknown as CDPConnection["DOM"],
    });

    await expect(
      new SurfingPage(conn).getState({ includeHidden: true })
    ).rejects.toThrow("DOM exceeds maximum node count");
    expect(runtimeEvaluate).toHaveBeenCalledTimes(1);
    expect(getDocument).not.toHaveBeenCalled();
  });

  it("resolves an action node once and always releases it", async () => {
    const resolveNode = mock(async () => ({ object: { objectId: "remote-7" } }));
    const releaseObject = mock(async () => ({}));
    const callFunctionOn = mock(async () => {
      if (callFunctionOn.mock.calls.length === 1) {
        return { result: { value: true } };
      }
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
    expect(callFunctionOn).toHaveBeenCalledTimes(2);
    expect(releaseObject).toHaveBeenCalledWith({ objectId: "remote-7" });
  });

  it("clears and types into contenteditable textboxes", async () => {
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
      dispatchEvent: mock(() => true),
      getAttribute: mock(() => null),
      ownerDocument: {
        getSelection: () => selection,
        createRange: () => ({
          selectNodeContents: mock(() => {}),
          collapse: mock(() => {}),
        }),
      },
    };
    const conn = connectionForPageObject(target, (text) => {
      target.textContent = String(target.textContent ?? "") + text;
    });

    await typeText(conn, 7, "new value", true);

    expect(target.textContent).toBe("new value");
    expect(selection.removeAllRanges).toHaveBeenCalledTimes(1);
    expect(selection.addRange).toHaveBeenCalledTimes(1);
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
      options: [{ value: "first" }, { value: "second" }],
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
    const callFunctionOn = mock(async () =>
      callFunctionOn.mock.calls.length === 1
        ? { result: { value: true } }
        : {
            exceptionDetails: {
              text: "Uncaught",
              exception: { description: "Error: click blocked" },
            },
          }
    );
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
        loadEventFired: mock(async () => {
          order.push("listen");
          return {};
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

  it("unsubscribes the load listener after navigation", async () => {
    const unsubscribe = mock(() => {});
    let loaded!: () => void;
    const conn = connection({
      Page: {
        loadEventFired: mock((handler: () => void) => {
          loaded = handler;
          return unsubscribe;
        }),
        navigate: mock(async () => {
          queueMicrotask(loaded);
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
    const releaseObject = mock(async () => {});
    const conn = connection({
      DOM: {
        resolveNode,
        setFileInputFiles,
      } as unknown as CDPConnection["DOM"],
      Runtime: {
        callFunctionOn: mock(async ({ functionDeclaration }: { functionDeclaration: string }) =>
          functionDeclaration.includes("isConnected")
            ? { result: { value: true } }
            : {}
        ),
        releaseObject,
      } as unknown as CDPConnection["Runtime"],
    });

    await setFileInput(conn, 17, ["/tmp/file.txt"]);

    expect(resolveNode).toHaveBeenCalledTimes(1);
    expect(setFileInputFiles).toHaveBeenCalledWith({
      files: ["/tmp/file.txt"],
      objectId: "upload-1",
    });
    expect(releaseObject).toHaveBeenCalledWith({ objectId: "upload-1" });
  });

  it("wraps browser navigation errors", async () => {
    const conn = connection({
      Page: {
        loadEventFired: mock(async () => ({})),
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
});
