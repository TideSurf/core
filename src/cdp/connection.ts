import CDP, { type Client } from "chrome-remote-interface";
import type { CDPNode } from "../types.js";
import {
  CDPConnectionError,
  ElementNotFoundError,
  NavigationError,
  TideSurfError,
  ValidationError,
} from "../errors.js";
import { withTimeout } from "./timeout.js";

/** Clipboard reads share one cooldown across connections. */
let lastClipboardReadTime = 0;
const CLIPBOARD_READ_COOLDOWN_MS = 5000; // 5 seconds between reads

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

async function grantClipboardPermissions(
  conn: CDPConnection,
  deadline: number
): Promise<void> {
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

  await withTimeout(
    conn.client.send("Browser.grantPermissions", params),
    remainingTimeout(deadline),
    "clipboard:grantPermissions"
  );
  await withTimeout(
    conn.client.send("Page.bringToFront"),
    remainingTimeout(deadline),
    "clipboard:bringToFront"
  );
}

export interface CDPConnection {
  client: Client;
  DOM: Client["DOM"];
  Page: Client["Page"];
  Runtime: Client["Runtime"];
  Input: Client["Input"];
  Emulation: Client["Emulation"];
}

/**
 * Connect to Chrome via CDP and enable required domains
 */
export async function connect(options: {
  port?: number;
  host?: string;
  tab?: number | string;
  timeout?: number;
}): Promise<CDPConnection> {
  const timeout = options.timeout ?? 10_000;
  let client: Client | undefined;
  let abandoned = false;
  const pendingClient = CDP({
    port: options.port ?? 9222,
    host: options.host ?? "localhost",
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
      timeout,
      "CDP connect"
    );

    const { DOM, Page, Runtime, Input, Emulation } = client;

    await withTimeout(
      Promise.all([DOM.enable(), Page.enable(), Runtime.enable()]),
      timeout,
      "CDP domain enable"
    );

    return { client, DOM, Page, Runtime, Input, Emulation };
  } catch (err) {
    abandoned = true;
    if (client) {
      await withTimeout(client.close(), Math.min(timeout, 1_000), "CDP rollback").catch(
        () => {}
      );
    }
    if (err instanceof TideSurfError) throw err;
    throw new CDPConnectionError(
      `Failed to connect to Chrome CDP: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err instanceof Error ? err : undefined }
    );
  }
}

export const MAX_DOM_NODES = 50_000;

/**
 * Count nodes in a CDP DOM tree recursively
 */
function countNodes(root: CDPNode): number {
  let count = 0;
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    count++;
    if (count > MAX_DOM_NODES) return count;
    for (const child of node.children ?? []) stack.push(child);
    for (const shadowRoot of node.shadowRoots ?? []) stack.push(shadowRoot);
    if (node.contentDocument) stack.push(node.contentDocument);
  }
  return count;
}

/**
 * Get the full DOM tree while bounding protocol response size. The composed
 * element pre-check runs before chrome-remote-interface parses the full tree.
 */
export async function getFullDOM(
  conn: CDPConnection,
  timeout?: number,
  knownElementCount?: number
): Promise<CDPNode> {
  let elementCount = knownElementCount;
  if (
    elementCount === undefined ||
    !Number.isInteger(elementCount) ||
    elementCount < 0
  ) {
    const preCheck = await runtimeEvaluate(
      conn,
      {
        expression: `(() => {
  const limit = ${MAX_DOM_NODES};
  let count = 0;
  let queuedElements = 0;
  const stack = [document];
  const enqueueElement = el => {
    if (!el) return true;
    queuedElements++;
    if (count + queuedElements > limit) return false;
    stack.push(el);
    return true;
  };
  while (stack.length > 0) {
    const current = stack.pop();
    if (current.nodeType === Node.DOCUMENT_NODE) {
      if (!enqueueElement(current.documentElement)) return limit + 1;
      continue;
    }
    if (current.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
      for (const child of current.children) {
        if (!enqueueElement(child)) return limit + 1;
      }
      continue;
    }
    if (current.nodeType !== Node.ELEMENT_NODE) continue;

    queuedElements--;
    count++;
    if (current.shadowRoot) stack.push(current.shadowRoot);
    if (current.tagName === 'IFRAME') {
      try { if (current.contentDocument) stack.push(current.contentDocument); } catch {}
    }
    for (const child of current.children) {
      if (!enqueueElement(child)) return limit + 1;
    }
  }
  return count;
})()`,
        returnByValue: true,
      },
      timeout ?? 5_000,
      "getFullDOM:preCount"
    );
    elementCount = Number(preCheck.result?.value ?? 0);
  }
  if (Number.isFinite(elementCount) && elementCount > MAX_DOM_NODES) {
    throw new Error(
      `DOM exceeds maximum node count of ${MAX_DOM_NODES.toLocaleString()} (found ${elementCount.toLocaleString()} elements). ` +
      `Use viewport mode or navigate to a simpler page.`
    );
  }

  const { root } = await withTimeout(
    conn.DOM.getDocument({ depth: -1, pierce: true }),
    timeout ?? 15_000,
    "getFullDOM"
  );

  // Include text, shadow, and frame nodes omitted by the element pre-check.
  const nodeCount = countNodes(root as unknown as CDPNode);
  if (nodeCount > MAX_DOM_NODES) {
    throw new Error(
      `DOM exceeds maximum node count of ${MAX_DOM_NODES.toLocaleString()} (found ${nodeCount.toLocaleString()}). ` +
      `Use viewport mode or navigate to a simpler page.`
    );
  }

  return root as unknown as CDPNode;
}

/**
 * Navigate to a URL and wait for load
 */
export async function navigate(
  conn: CDPConnection,
  url: string,
  timeout?: number
): Promise<void> {
  const operationTimeout = timeout ?? 30_000;
  let resolveLoaded!: () => void;
  const loaded = new Promise<void>((resolveLoad) => {
    resolveLoaded = resolveLoad;
  });
  const unsubscribe = (
    conn.Page.loadEventFired as unknown as (
      handler: () => void
    ) => (() => void) | Promise<unknown>
  )(() => resolveLoaded());
  try {
    const result = (await withTimeout(
      conn.Page.navigate({ url }),
      operationTimeout,
      "navigate:request"
    )) as { errorText?: string; loaderId?: string };
    if (result.errorText) throw new Error(result.errorText);
    if (result.loaderId) {
      await withTimeout(loaded, operationTimeout, "navigate:load");
    }
  } catch (err) {
    if (err instanceof NavigationError) throw err;
    throw new NavigationError(
      url,
      err instanceof Error ? err.message : String(err),
      { cause: err instanceof Error ? err : undefined }
    );
  } finally {
    if (typeof unsubscribe === "function") unsubscribe();
  }
}

async function withResolvedNode<T>(
  conn: CDPConnection,
  backendNodeId: number,
  timeout: number,
  operation: string,
  use: (objectId: string) => Promise<T>
): Promise<T> {
  const { object } = await withTimeout(
    conn.DOM.resolveNode({ backendNodeId }),
    timeout,
    `${operation}:resolve`
  );
  const objectId = object.objectId;
  if (!objectId) throw new ElementNotFoundError(`backendNodeId:${backendNodeId}`);

  try {
    const connected = await callFunction(
      conn,
      {
        objectId,
        functionDeclaration: "function() { return this.isConnected === true; }",
        returnByValue: true,
      },
      timeout,
      `${operation}:connected`
    );
    if (connected.result?.value === false) {
      throw new ElementNotFoundError(`backendNodeId:${backendNodeId}`, "The mapped node is detached.");
    }
    return await use(objectId);
  } finally {
    await withTimeout(
      conn.Runtime.releaseObject({ objectId }),
      timeout,
      `${operation}:release`
    ).catch(() => {});
  }
}

/**
 * Click a node by backendNodeId
 */
export async function clickNode(
  conn: CDPConnection,
  backendNodeId: number,
  timeout?: number
): Promise<void> {
  const operationTimeout = timeout ?? 5_000;
  await withResolvedNode(conn, backendNodeId, operationTimeout, "clickNode", (objectId) =>
    callFunction(
      conn,
      {
        objectId,
        functionDeclaration: "function() { this.click(); }",
        returnByValue: true,
      },
      operationTimeout,
      "clickNode:click"
    ).then(() => undefined)
  );
}

/**
 * Type text into a node
 */
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
    async (objectId) => {
      await callFunction(
        conn,
        {
          objectId,
          functionDeclaration: `function() {
            const tag = this.tagName;
            const type = tag === 'INPUT'
              ? String(this.type || 'text').toLowerCase()
              : '';
            const nonTextInput = [
              'button', 'checkbox', 'color', 'file', 'hidden', 'image',
              'radio', 'range', 'reset', 'submit'
            ].includes(type);
            const editable = tag === 'TEXTAREA' ||
              (tag === 'INPUT' && !nonTextInput) ||
              this.isContentEditable === true;
            if (!editable) {
              throw new Error('Target is not a text-editable input, textarea, or contenteditable element');
            }
            if (this.disabled || this.readOnly || this.getAttribute?.('aria-disabled') === 'true') {
              throw new Error('Target is disabled or read-only');
            }
            this.focus();
          }`,
          returnByValue: true,
        },
        operationTimeout,
        "typeText:focus"
      );

      if (clear) {
        await callFunction(
          conn,
          {
            objectId,
            functionDeclaration: `function() {
              if (this.isContentEditable === true) {
                this.textContent = '';
                const selection = this.ownerDocument.getSelection();
                if (selection) {
                  const range = this.ownerDocument.createRange();
                  range.selectNodeContents(this);
                  range.collapse(false);
                  selection.removeAllRanges();
                  selection.addRange(range);
                }
              } else {
                this.value = '';
              }
            }`,
            returnByValue: true,
          },
          operationTimeout,
          "typeText:clear"
        );
      }

      const input = conn.Input as unknown as {
        insertText(params: { text: string }): Promise<void>;
      };
      await withTimeout(input.insertText({ text }), operationTimeout, "typeText:insert");
      await callFunction(
        conn,
        {
          objectId,
          functionDeclaration:
            "function() { this.dispatchEvent(new Event('input', {bubbles: true})); this.dispatchEvent(new Event('change', {bubbles: true})); }",
          returnByValue: true,
        },
        operationTimeout,
        "typeText:events"
      );
    }
  );
}

/**
 * Select an option in a <select> element
 */
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
    (objectId) =>
      callFunction(
        conn,
        {
          objectId,
          functionDeclaration: `function(value) {
            if (this.tagName !== 'SELECT') {
              throw new Error('Target is not a native select element');
            }
            if (this.disabled || this.getAttribute?.('aria-disabled') === 'true') {
              throw new Error('Target is disabled');
            }
            if (!Array.from(this.options).some(option => option.value === value)) {
              throw new Error('Select option does not exist: ' + value);
            }
            this.value = value;
            this.dispatchEvent(new Event('input', {bubbles: true}));
            this.dispatchEvent(new Event('change', {bubbles: true}));
          }`,
          arguments: [{ value }],
          returnByValue: true,
        },
        operationTimeout,
        "selectOption:select"
      ).then(() => undefined)
  );
}

/**
 * Scroll the page
 */
export async function scroll(
  conn: CDPConnection,
  direction: "up" | "down",
  amount: number = 500,
  timeout?: number
): Promise<void> {
  const delta = direction === "down" ? amount : -amount;
  await runtimeEvaluate(
    conn,
    {
      expression: `window.scrollBy(0, ${delta})`,
    },
    timeout ?? 5_000,
    "scroll"
  );
}

/** Execute JavaScript in the page context. */
export async function evaluate(
  conn: CDPConnection,
  expression: string,
  timeout?: number
): Promise<unknown> {
  const result = assertRuntimeSuccess(
    await withTimeout(
      conn.Runtime.evaluate({
        expression,
        returnByValue: true,
        awaitPromise: true,
      }),
      timeout ?? 10_000,
      "evaluate"
    ),
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
  const hardTimeout = Math.max(1, timeout);
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
  observer.observe(document.body || document.documentElement, {
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

/**
 * Capture a screenshot of the page.
 * @returns Base64-encoded PNG string
 */
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
    params.clip = options.clip;
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

/** Set files on a file input and dispatch its change event. */
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
    async (objectId) => {
      await withTimeout(
        conn.DOM.setFileInputFiles({ files: filePaths, objectId }),
        operationTimeout,
        "setFileInput:files"
      );
      await callFunction(
        conn,
        {
          objectId,
          functionDeclaration:
            "function() { this.dispatchEvent(new Event('change', { bubbles: true })); }",
          returnByValue: true,
        },
        operationTimeout,
        "setFileInput:change"
      );
    }
  );
}

/** Read text from the clipboard with a global cooldown. */
export async function clipboardRead(
  conn: CDPConnection,
  timeout?: number
): Promise<string> {
  // Reserve before awaiting so concurrent callers cannot share one slot.
  const now = Date.now();
  const timeSinceLastRead = now - lastClipboardReadTime;

  if (timeSinceLastRead < CLIPBOARD_READ_COOLDOWN_MS) {
    const remaining = Math.ceil((CLIPBOARD_READ_COOLDOWN_MS - timeSinceLastRead) / 1000);
    throw new ValidationError(
      `Clipboard read rate limit exceeded. Please wait ${remaining} second(s) before reading again.`
    );
  }
  lastClipboardReadTime = now;

  const deadline = Date.now() + (timeout ?? 5_000);
  await grantClipboardPermissions(conn, deadline);

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

  return String(result.result?.value ?? "");
}

/**
 * Write text to the clipboard.
 */
export async function clipboardWrite(
  conn: CDPConnection,
  text: string,
  timeout?: number
): Promise<void> {
  const deadline = Date.now() + (timeout ?? 5_000);
  await grantClipboardPermissions(conn, deadline);

  await runtimeEvaluate(
    conn,
    {
      expression: `navigator.clipboard.writeText(${JSON.stringify(text)})`,
      awaitPromise: true,
      userGesture: true,
      returnByValue: true,
    },
    remainingTimeout(deadline),
    "clipboard:write"
  );
}

/** Close the transport. Chrome drops enabled domains with the session. */
export async function disconnect(
  conn: CDPConnection,
  timeout = 2_000
): Promise<void> {
  await withTimeout(conn.client.close(), timeout, "CDP disconnect");
}
