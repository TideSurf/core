import CDP, { type Client } from "chrome-remote-interface";
import {
  ActionCommittedError,
  CDPConnectionError,
  CDPTimeoutError,
  ElementNotFoundError,
  NavigationError,
  TideSurfError,
  ValidationError,
} from "../errors.js";
import {
  MAX_TIMER_DELAY_MS,
  validateScreenshotDimensions,
} from "../validation.js";
import { withTimeout } from "./timeout.js";

const CLIPBOARD_READ_COOLDOWN_MS = 5_000;

interface ClipboardCoordinator {
  references: number;
  lastReadTime: number;
  tail: Promise<void>;
}

const endpointClipboardCoordinators = new Map<string, ClipboardCoordinator>();
const connectionClipboardCoordinators = new WeakMap<
  CDPConnection,
  ClipboardCoordinator
>();
const clipboardCoordinatorReleases = new WeakMap<CDPConnection, () => void>();

function clipboardCoordinator(conn: CDPConnection): ClipboardCoordinator {
  const existing = connectionClipboardCoordinators.get(conn);
  if (existing) return existing;
  const coordinator: ClipboardCoordinator = {
    references: 1,
    lastReadTime: 0,
    tail: Promise.resolve(),
  };
  connectionClipboardCoordinators.set(conn, coordinator);
  return coordinator;
}

function registerClipboardCoordinator(
  conn: CDPConnection,
  endpoint: string
): void {
  let coordinator = endpointClipboardCoordinators.get(endpoint);
  if (coordinator) {
    coordinator.references++;
  } else {
    coordinator = {
      references: 1,
      lastReadTime: 0,
      tail: Promise.resolve(),
    };
    endpointClipboardCoordinators.set(endpoint, coordinator);
  }
  connectionClipboardCoordinators.set(conn, coordinator);

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    conn.client.removeListener("disconnect", release);
    clipboardCoordinatorReleases.delete(conn);
    connectionClipboardCoordinators.delete(conn);
    coordinator.references--;
    if (
      coordinator.references === 0 &&
      endpointClipboardCoordinators.get(endpoint) === coordinator
    ) {
      endpointClipboardCoordinators.delete(endpoint);
    }
  };
  clipboardCoordinatorReleases.set(conn, release);
  conn.client.once("disconnect", release);
}

function serializeClipboard<T>(
  conn: CDPConnection,
  operation: () => Promise<T>
): Promise<T> {
  const coordinator = clipboardCoordinator(conn);
  const result = coordinator.tail.then(operation);
  coordinator.tail = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

function reserveClipboardUntil(
  conn: CDPConnection,
  pending: Promise<unknown>
): void {
  const coordinator = clipboardCoordinator(conn);
  const settled = () => pending.then(
    () => undefined,
    () => undefined
  );
  coordinator.tail = coordinator.tail.then(settled, settled);
}

interface RuntimeResponse {
  result?: {
    value?: unknown;
    unserializableValue?: string;
    description?: string;
  };
  exceptionDetails?: {
    text?: string;
    exception?: {
      description?: string;
      value?: unknown;
    };
  };
}

function assertRuntimeSuccess(
  response: unknown,
  operation: string
): RuntimeResponse {
  const runtimeResponse = response as RuntimeResponse;
  const details = runtimeResponse.exceptionDetails;
  if (!details) return runtimeResponse;

  const exceptionValue = details.exception?.value;
  const message =
    details.exception?.description ??
    (exceptionValue === undefined ? undefined : String(exceptionValue)) ??
    details.text ??
    "unknown error";
  throw new Error(`${operation} failed: ${message}`);
}

async function callFunction(
  conn: CDPConnection,
  params: Parameters<CDPConnection["Runtime"]["callFunctionOn"]>[0],
  timeout: number,
  operation: string
): Promise<RuntimeResponse> {
  return assertRuntimeSuccess(
    await withTimeout(
      conn.Runtime.callFunctionOn(params),
      timeout,
      operation
    ),
    operation
  );
}

async function runtimeEvaluate(
  conn: CDPConnection,
  params: Parameters<CDPConnection["Runtime"]["evaluate"]>[0],
  timeout: number,
  operation: string
): Promise<RuntimeResponse> {
  return assertRuntimeSuccess(
    await withTimeout(conn.Runtime.evaluate(params), timeout, operation),
    operation
  );
}

function remainingTimeout(deadline: number): number {
  return Math.max(1, deadline - Date.now());
}

async function runMutation<T>(
  conn: CDPConnection,
  operation: string,
  request: () => Promise<T>
): Promise<T> {
  if (conn.disconnected) {
    throw new CDPConnectionError("Chrome is disconnected");
  }
  let disconnected = false;
  let rejectDisconnect!: (error: Error) => void;
  const disconnectSignal = new Promise<never>((_resolve, reject) => {
    rejectDisconnect = reject;
  });
  void disconnectSignal.catch(() => undefined);
  const onDisconnect = () => {
    disconnected = true;
    rejectDisconnect(
      new CDPConnectionError(`Chrome disconnected during ${operation}`)
    );
  };
  conn.client.once("disconnect", onDisconnect);
  try {
    return await Promise.race([request(), disconnectSignal]);
  } catch (error) {
    if (
      disconnected ||
      error instanceof CDPConnectionError ||
      error instanceof CDPTimeoutError
    ) {
      throw new ActionCommittedError(operation, error, "uncertain");
    }
    throw error;
  } finally {
    conn.client.removeListener("disconnect", onDisconnect);
  }
}

async function withClipboardPermissionsUnlocked<T>(
  conn: CDPConnection,
  timeout: number,
  operation: (deadline: number) => Promise<T>,
  committedOperation?: string
): Promise<T> {
  const deadline = Date.now() + timeout;
  const originResult = await runtimeEvaluate(
    conn,
    {
      expression: "location.origin",
      returnByValue: true,
    },
    remainingTimeout(deadline),
    "clipboard:origin"
  );
  const origin =
    typeof originResult.result?.value === "string" &&
    originResult.result.value !== "null"
      ? originResult.result.value
      : undefined;
  const params: Record<string, unknown> = {
    permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"],
  };
  if (origin) {
    params.origin = origin;
  }

  const grant = conn.client.send("Browser.grantPermissions", params);
  let grantCompleted = false;
  let operationFailed = true;
  const reset = async () => {
    const pending = conn.client.send("Browser.resetPermissions");
    try {
      await withTimeout(
        pending,
        Math.min(remainingTimeout(deadline), 1_000),
        "clipboard:resetPermissions"
      );
    } catch (error) {
      reserveClipboardUntil(conn, pending);
      throw error;
    }
  };
  try {
    await withTimeout(
      grant,
      remainingTimeout(deadline),
      "clipboard:grantPermissions"
    );
    grantCompleted = true;
    await withTimeout(
      conn.client.send("Page.bringToFront"),
      remainingTimeout(deadline),
      "clipboard:bringToFront"
    );
    const result = await operation(deadline);
    operationFailed = false;
    return result;
  } finally {
    try {
      await reset();
    } catch (error) {
      if (!operationFailed) {
        throw committedOperation
          ? new ActionCommittedError(committedOperation, error)
          : error;
      }
    }
    if (!grantCompleted) {
      void grant
        .then(() => serializeClipboard(conn, reset))
        .catch(() => undefined);
    }
  }
}

function withClipboardPermissions<T>(
  conn: CDPConnection,
  timeout: number,
  operation: (deadline: number) => Promise<T>,
  committedOperation?: string
): Promise<T> {
  return serializeClipboard(conn, () =>
    withClipboardPermissionsUnlocked(
      conn,
      timeout,
      operation,
      committedOperation
    )
  );
}

export interface CDPConnection {
  client: Client;
  DOM: Client["DOM"];
  Page: Client["Page"];
  Runtime: Client["Runtime"];
  Emulation: Client["Emulation"];
  disconnected: boolean;
}

/** Connect to Chrome and enable the required CDP domains. */
export async function connect(options: {
  port?: number;
  host?: string;
  tab?: number | string;
  timeout?: number;
}): Promise<CDPConnection> {
  const timeout = options.timeout ?? 10_000;
  const deadline = Date.now() + timeout;
  const port = options.port ?? 9222;
  const host = options.host ?? "localhost";
  let client: Client | undefined;
  let abandoned = false;
  const pendingClient = CDP({
    port,
    host,
    target: options.tab,
    useHostName: true,
  });
  void pendingClient.then(async (lateClient) => {
    if (abandoned) {
      await withTimeout(lateClient.close(), 1_000, "late CDP rollback").catch(
        () => undefined
      );
    }
  }).catch(() => undefined);
  try {
    client = await withTimeout(
      pendingClient,
      remainingTimeout(deadline),
      "CDP connect"
    );

    const { DOM, Page, Runtime, Emulation } = client;

    await withTimeout(
      Promise.all([DOM.enable(), Page.enable(), Runtime.enable()]),
      remainingTimeout(deadline),
      "CDP domain enable"
    );
    await withTimeout(
      Page.setLifecycleEventsEnabled({ enabled: true }),
      remainingTimeout(deadline),
      "CDP lifecycle enable"
    );

    const conn = { client, DOM, Page, Runtime, Emulation, disconnected: false };
    client.once("disconnect", () => {
      conn.disconnected = true;
    });
    registerClipboardCoordinator(conn, `${host}:${port}`);
    return conn;
  } catch (err) {
    abandoned = true;
    if (client) {
      try {
        await withTimeout(
          client.close(),
          Math.min(timeout, 1_000),
          "CDP rollback"
        );
      } catch (cleanupError) {
        throw new CDPConnectionError(
          "Failed to initialize Chrome CDP and close the partial connection",
          {
            cause: new AggregateError(
              [err, cleanupError],
              "CDP initialization and rollback failed"
            ),
          }
        );
      }
    }
    if (err instanceof TideSurfError) throw err;
    throw new CDPConnectionError(
      `Failed to connect to Chrome CDP: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err instanceof Error ? err : undefined }
    );
  }
}

export const MAX_DOM_NODES = 50_000;

export async function navigate(
  conn: CDPConnection,
  url: string,
  timeout?: number
): Promise<void> {
  const operationTimeout = timeout ?? 30_000;
  const deadline = Date.now() + operationTimeout;
  const loadedLoaders = new Set<string>();
  let expectedLoader: string | undefined;
  let resolveLoaded!: () => void;
  const loaded = new Promise<void>((resolveLoad) => {
    resolveLoaded = resolveLoad;
  });
  let rejectDisconnect!: (error: Error) => void;
  const disconnectSignal = new Promise<never>((_resolve, reject) => {
    rejectDisconnect = reject;
  });
  void disconnectSignal.catch(() => undefined);
  let disconnected = false;
  const onDisconnect = () => {
    disconnected = true;
    rejectDisconnect(
      new CDPConnectionError("Chrome disconnected during navigation")
    );
  };
  conn.client.once("disconnect", onDisconnect);
  const unsubscribe = conn.Page.lifecycleEvent((event) => {
    if (event.name !== "load") return;
    if (expectedLoader === undefined) loadedLoaders.add(event.loaderId);
    else if (event.loaderId === expectedLoader) resolveLoaded();
  });
  let committed = false;
  try {
    const result = await withTimeout(
      Promise.race([conn.Page.navigate({ url }), disconnectSignal]),
      remainingTimeout(deadline),
      "navigate:request"
    );
    if (result.errorText) throw new Error(result.errorText);
    if (result.loaderId) {
      committed = true;
      expectedLoader = result.loaderId;
      if (loadedLoaders.has(expectedLoader)) resolveLoaded();
      loadedLoaders.clear();
      await withTimeout(
        Promise.race([loaded, disconnectSignal]),
        remainingTimeout(deadline),
        "navigate:load"
      );
    }
  } catch (err) {
    if (committed) throw new ActionCommittedError("Navigation", err);
    if (disconnected || err instanceof CDPTimeoutError) {
      throw new ActionCommittedError("Navigation", err, "uncertain");
    }
    throw new NavigationError(
      url,
      err instanceof Error ? err.message : String(err),
      { cause: err instanceof Error ? err : undefined }
    );
  } finally {
    unsubscribe();
    conn.client.removeListener("disconnect", onDisconnect);
  }
}

async function withResolvedNode<T>(
  conn: CDPConnection,
  backendNodeId: number,
  timeout: number,
  operation: string,
  use: (objectId: string, remaining: () => number) => Promise<T>
): Promise<T> {
  const deadline = Date.now() + timeout;
  const remaining = () => remainingTimeout(deadline);
  const { object } = await withTimeout(
    conn.DOM.resolveNode({ backendNodeId }),
    remaining(),
    `${operation}:resolve`
  );
  const objectId = object.objectId;
  if (!objectId) throw new ElementNotFoundError(`backendNodeId:${backendNodeId}`);

  try {
    return await use(objectId, remaining);
  } finally {
    await withTimeout(
      conn.Runtime.releaseObject({ objectId }),
      Math.min(1_000, remaining()),
      `${operation}:release`
    ).catch(() => undefined);
  }
}

export async function clickNode(
  conn: CDPConnection,
  backendNodeId: number,
  timeout?: number
): Promise<void> {
  const operationTimeout = timeout ?? 5_000;
  await withResolvedNode(
    conn,
    backendNodeId,
    operationTimeout,
    "clickNode",
    (objectId, remaining) =>
      runMutation(conn, "Click", () =>
        callFunction(
          conn,
          {
            objectId,
            functionDeclaration: `function() {
          if (this.isConnected !== true) return false;
          const ariaDisabled = this.closest('[aria-disabled="true" i]') !== null;
          const inert = this.closest('[inert]') !== null;
          const pointerBlocked = this.ownerDocument.defaultView
            .getComputedStyle(this).pointerEvents === 'none';
          if (this.matches(':disabled') || ariaDisabled || inert || pointerBlocked) {
            throw new Error('Target is disabled or inert');
          }
          this.click();
          return true;
        }`,
            returnByValue: true,
          },
          remaining(),
          "clickNode:click"
        ).then((result) => {
          if (result.result?.value === false) {
            throw new ElementNotFoundError(
              `backendNodeId:${backendNodeId}`,
              "The mapped node is detached."
            );
          }
        })
      )
  );
}

export async function typeText(
  conn: CDPConnection,
  backendNodeId: number,
  text: string,
  clear: boolean = false,
  timeout?: number
): Promise<void> {
  const operationTimeout = timeout ?? 5_000;
  await withResolvedNode(
    conn,
    backendNodeId,
    operationTimeout,
    "typeText",
    (objectId, remaining) =>
      runMutation(conn, "Typing", () =>
        callFunction(
          conn,
          {
            objectId,
            functionDeclaration: `function(text, clear) {
            if (this.isConnected !== true) return false;
            const tag = this.tagName;
            const type = tag === 'INPUT'
              ? String(this.type || 'text').toLowerCase()
              : '';
            let nonTextInput = false;
            switch (type) {
              case 'button':
              case 'checkbox':
              case 'color':
              case 'file':
              case 'hidden':
              case 'image':
              case 'radio':
              case 'range':
              case 'reset':
              case 'submit':
                nonTextInput = true;
                break;
            }
            const editable = tag === 'TEXTAREA' ||
              (tag === 'INPUT' && !nonTextInput) ||
              this.isContentEditable === true;
            if (!editable) {
              throw new Error('Target is not a text-editable input, textarea, or contenteditable element');
            }
            const ariaDisabled = this.closest('[aria-disabled="true" i]') !== null;
            const inert = this.closest('[inert]') !== null;
            const pointerBlocked = this.ownerDocument.defaultView
              .getComputedStyle(this).pointerEvents === 'none';
            if (this.matches(':disabled') || this.readOnly || ariaDisabled || inert || pointerBlocked) {
              throw new Error('Target is disabled or read-only');
            }
            let changed = false;
            if (this.isContentEditable === true) {
              const before = this.textContent || '';
              if (clear) this.textContent = '';
              if (text) {
                const selection = this.ownerDocument.getSelection();
                const range = !clear && selection?.rangeCount && this.contains(selection.anchorNode)
                  ? selection.getRangeAt(0)
                  : undefined;
                if (range) {
                  range.deleteContents();
                  const node = this.ownerDocument.createTextNode(text);
                  range.insertNode(node);
                  range.setStartAfter(node);
                  range.collapse(true);
                  selection.removeAllRanges();
                  selection.addRange(range);
                } else if (typeof this.append === 'function') {
                  this.append(text);
                } else {
                  this.textContent = (this.textContent || '') + text;
                }
              }
              changed = (this.textContent || '') !== before;
            } else {
              const before = String(this.value || '');
              const start = clear ? 0 : (this.selectionStart ?? before.length);
              const end = clear ? before.length : (this.selectionEnd ?? start);
              const retainedLength = before.length - (end - start);
              const maxLength = Number.isInteger(this.maxLength) && this.maxLength >= 0
                ? this.maxLength
                : Infinity;
              const available = Math.max(0, maxLength - retainedLength);
              let inserted = text.slice(0, available);
              if (
                inserted.length < text.length &&
                /[\uD800-\uDBFF]$/.test(inserted) &&
                /^[\uDC00-\uDFFF]/.test(text.slice(inserted.length))
              ) {
                inserted = inserted.slice(0, -1);
              }
              const next = before.slice(0, start) + inserted + before.slice(end);
              const view = this.ownerDocument.defaultView;
              const prototype = tag === 'INPUT'
                ? view.HTMLInputElement.prototype
                : view.HTMLTextAreaElement.prototype;
              const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
              if (setter) setter.call(this, next);
              else this.value = next;
              const caret = start + inserted.length;
              if (
                typeof this.selectionStart === 'number' &&
                typeof this.setSelectionRange === 'function'
              ) {
                this.setSelectionRange(caret, caret);
              }
              changed = next !== before;
            }
            if (changed) this.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
          }`,
            arguments: [{ value: text }, { value: clear }],
            returnByValue: true,
          },
          remaining(),
          "typeText:type"
        ).then((result) => {
          if (result.result?.value === false) {
            throw new ElementNotFoundError(
              `backendNodeId:${backendNodeId}`,
              "The mapped node is detached."
            );
          }
        })
      )
  );
}

export async function selectOption(
  conn: CDPConnection,
  backendNodeId: number,
  value: string,
  timeout?: number
): Promise<void> {
  const operationTimeout = timeout ?? 5_000;
  await withResolvedNode(
    conn,
    backendNodeId,
    operationTimeout,
    "selectOption",
    (objectId, remaining) =>
      runMutation(conn, "Selection", () =>
        callFunction(
          conn,
          {
            objectId,
            functionDeclaration: `function(value) {
            if (this.isConnected !== true) return false;
            if (this.tagName !== 'SELECT') {
              throw new Error('Target is not a native select element');
            }
            const ariaDisabled = this.closest('[aria-disabled="true" i]') !== null;
            const inert = this.closest('[inert]') !== null;
            const pointerBlocked = this.ownerDocument.defaultView
              .getComputedStyle(this).pointerEvents === 'none';
            if (this.matches(':disabled') || ariaDisabled || inert || pointerBlocked) {
              throw new Error('Target is disabled or inert');
            }
            let option;
            for (let index = 0; index < this.options.length; index++) {
              const candidate = this.options[index];
              if (candidate.value === value) {
                option = candidate;
                break;
              }
            }
            if (!option) {
              throw new Error('Select option does not exist: ' + value);
            }
            if (option.matches(':disabled')) {
              throw new Error('Select option is disabled: ' + value);
            }
            this.value = value;
            this.dispatchEvent(new Event('input', {bubbles: true}));
            this.dispatchEvent(new Event('change', {bubbles: true}));
            return true;
          }`,
            arguments: [{ value }],
            returnByValue: true,
          },
          remaining(),
          "selectOption:select"
        ).then((result) => {
          if (result.result?.value === false) {
            throw new ElementNotFoundError(
              `backendNodeId:${backendNodeId}`,
              "The mapped node is detached."
            );
          }
        })
      )
  );
}

export async function scroll(
  conn: CDPConnection,
  direction: "up" | "down",
  amount: number = 500,
  timeout?: number
): Promise<void> {
  const delta = direction === "down" ? amount : -amount;
  await runMutation(conn, "Scroll", () =>
    runtimeEvaluate(
      conn,
      {
        expression: `window.scrollBy({ top: ${delta}, left: 0, behavior: 'instant' })`,
      },
      timeout ?? 5_000,
      "scroll"
    )
  );
}

export async function evaluate(
  conn: CDPConnection,
  expression: string,
  timeout?: number,
  committedOperation?: string
): Promise<unknown> {
  const request = () => withTimeout(
    conn.Runtime.evaluate({
      expression,
      returnByValue: true,
      awaitPromise: true,
    }),
    timeout ?? 10_000,
    "evaluate"
  );
  const result = assertRuntimeSuccess(
    committedOperation
      ? await runMutation(conn, committedOperation, request)
      : await request(),
    "Evaluation"
  );
  if (!result.result) {
    throw new Error("Evaluation returned no result");
  }
  return Object.prototype.hasOwnProperty.call(result.result, "value")
    ? result.result.value
    : result.result.unserializableValue;
}

/** Wait for 300ms without a DOM mutation, bounded by a page-side deadline. */
export async function waitForStable(
  conn: CDPConnection,
  timeout: number = 5000
): Promise<void> {
  const hardTimeout = Math.min(
    Math.max(1, timeout),
    MAX_TIMER_DELAY_MS - 250
  );
  await runtimeEvaluate(
    conn,
    {
      expression: `new Promise(resolve => {
  let observer;
  let quietTimer;
  let hardTimer;
  let resolved = false;
  const done = () => {
    if (resolved) return;
    resolved = true;
    clearTimeout(quietTimer);
    clearTimeout(hardTimer);
    observer.disconnect();
    resolve();
  };
  observer = new MutationObserver(() => {
    clearTimeout(quietTimer);
    quietTimer = setTimeout(done, 300);
  });
  const root = document.documentElement || document.body;
  if (!root) {
    resolve();
    return;
  }
  observer.observe(root, {
    childList: true, subtree: true, attributes: true, characterData: true
  });
  quietTimer = setTimeout(done, 300);
  hardTimer = setTimeout(done, ${hardTimeout});
})`,
      awaitPromise: true,
    },
    hardTimeout + 250,
    "waitForStable"
  );
}

export async function captureScreenshot(
  conn: CDPConnection,
  options?: {
    clip?: { x: number; y: number; width: number; height: number; scale: number };
    fullPage?: boolean;
  },
  timeout?: number
): Promise<string> {
  const params: {
    format: string;
    clip?: { x: number; y: number; width: number; height: number; scale: number };
    captureBeyondViewport?: boolean;
  } = { format: "png" };

  if (options?.clip) {
    const { width, height, scale } = options.clip;
    validateScreenshotDimensions(width, height, scale);
    params.clip = options.clip;
    params.captureBeyondViewport = true;
  }

  if (options?.fullPage) {
    params.captureBeyondViewport = true;
  }

  const { data } = await withTimeout(
    conn.Page.captureScreenshot(params),
    timeout ?? 15_000,
    "captureScreenshot"
  );
  return data;
}

export async function setFileInput(
  conn: CDPConnection,
  backendNodeId: number,
  filePaths: string[],
  timeout?: number
): Promise<void> {
  const operationTimeout = timeout ?? 10_000;
  await withResolvedNode(
    conn,
    backendNodeId,
    operationTimeout,
    "setFileInput",
    (objectId, remaining) =>
      runMutation(conn, "Upload", () =>
        withTimeout(
          conn.DOM.setFileInputFiles({ files: filePaths, objectId }),
          remaining(),
          "setFileInput:files"
        )
      )
  );
}

export async function clipboardRead(
  conn: CDPConnection,
  timeout?: number
): Promise<string> {
  const coordinator = clipboardCoordinator(conn);
  const now = Date.now();
  const timeSinceLastRead = now - coordinator.lastReadTime;

  if (timeSinceLastRead < CLIPBOARD_READ_COOLDOWN_MS) {
    const remaining = Math.ceil((CLIPBOARD_READ_COOLDOWN_MS - timeSinceLastRead) / 1000);
    throw new ValidationError(
      `Clipboard read rate limit exceeded. Please wait ${remaining} second(s) before reading again.`
    );
  }
  coordinator.lastReadTime = now;

  return withClipboardPermissions(conn, timeout ?? 5_000, async (deadline) => {
    const result = await runtimeEvaluate(
      conn,
      {
        expression: "navigator.clipboard.readText()",
        awaitPromise: true,
        userGesture: true,
        returnByValue: true,
      },
      remainingTimeout(deadline),
      "clipboard:read"
    );

    const value = result.result?.value;
    if (typeof value !== "string") {
      throw new Error("Clipboard read returned no text result");
    }
    return value;
  });
}

export async function clipboardWrite(
  conn: CDPConnection,
  text: string,
  timeout?: number
): Promise<void> {
  await withClipboardPermissions(conn, timeout ?? 5_000, (deadline) =>
    runMutation(conn, "Clipboard write", () =>
      runtimeEvaluate(
        conn,
        {
          expression: `navigator.clipboard.writeText(${JSON.stringify(text)})`,
          awaitPromise: true,
          userGesture: true,
          returnByValue: true,
        },
        remainingTimeout(deadline),
        "clipboard:write"
      ).then(() => undefined)
    ),
    "Clipboard write"
  );
}

export async function disconnect(
  conn: CDPConnection,
  timeout = 2_000
): Promise<void> {
  if (conn.disconnected) {
    clipboardCoordinatorReleases.get(conn)?.();
    return;
  }
  try {
    await withTimeout(conn.client.close(), timeout, "CDP disconnect");
  } finally {
    conn.disconnected = true;
    clipboardCoordinatorReleases.get(conn)?.();
  }
}
