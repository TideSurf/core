import CDP, { type Client } from "chrome-remote-interface";
import type { CDPNode } from "../types.js";
import { CDPConnectionError, CDPTimeoutError, ElementNotFoundError, NavigationError, TideSurfError, ValidationError } from "../errors.js";
import { withTimeout } from "./timeout.js";

/**
 * Clipboard rate limiting state
 * HIGH-020: Limit clipboard reads to prevent data exfiltration
 */
let lastClipboardReadTime = 0;
const CLIPBOARD_READ_COOLDOWN_MS = 5000; // 5 seconds between reads

export interface CDPConnection {
  client: Client;
  DOM: Client["DOM"];
  Page: Client["Page"];
  Runtime: Client["Runtime"];
  Input: Client["Input"];
  Emulation: Client["Emulation"];
  /** True if the connection is dead (Chrome crashed or disconnected) */
  isDead?: boolean;
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
  try {
    const client = await withTimeout(
      CDP({
        port: options.port ?? 9222,
        host: options.host ?? "localhost",
        target: options.tab,
        useHostName: true,
      }),
      options.timeout ?? 10_000,
      "CDP connect"
    );

    const { DOM, Page, Runtime, Input, Emulation } = client;

    await Promise.all([DOM.enable(), Page.enable(), Runtime.enable()]);

    const conn: CDPConnection = { client, DOM, Page, Runtime, Input, Emulation, isDead: false };

    // HIGH-018: Chrome crash/disconnect detection
    // Type assertion needed because chrome-remote-interface types don't expose event methods
    (client as unknown as { on(event: string, handler: () => void): void }).on("disconnect", () => {
      conn.isDead = true;
    });
    (Page as unknown as { on(event: string, handler: () => void): void }).on("targetCrashed", () => {
      conn.isDead = true;
    });

    return conn;
  } catch (err) {
    if (err instanceof TideSurfError) throw err;
    throw new CDPConnectionError(
      `Failed to connect to Chrome CDP: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err instanceof Error ? err : undefined }
    );
  }
}

// NEW-CRIT-005: Maximum DOM node count to prevent memory exhaustion
const MAX_DOM_NODES = 50_000;

/**
 * Count nodes in a CDP DOM tree recursively
 */
function countNodes(node: CDPNode): number {
  let count = 1;
  if (node.children) {
    for (const child of node.children) {
      count += countNodes(child);
    }
  }
  if (node.shadowRoots) {
    for (const shadow of node.shadowRoots) {
      count += countNodes(shadow);
    }
  }
  if (node.contentDocument) {
    count += countNodes(node.contentDocument);
  }
  return count;
}

/**
 * Get the full DOM tree (pierces shadow DOM)
 * NEW-CRIT-005: Enforces 50,000 node limit to prevent memory exhaustion
 */
export async function getFullDOM(conn: CDPConnection, timeout?: number): Promise<CDPNode> {
  const { root } = await withTimeout(
    conn.DOM.getDocument({ depth: -1, pierce: true }),
    timeout ?? 15_000,
    "getFullDOM"
  );

  // NEW-CRIT-005: Check node count to prevent memory exhaustion
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
  try {
    await conn.Page.navigate({ url });
    await withTimeout(
      conn.Page.loadEventFired(),
      timeout ?? 30_000,
      "navigate"
    );
  } catch (err) {
    if (err instanceof NavigationError) throw err;
    throw new NavigationError(
      url,
      err instanceof Error ? err.message : String(err),
      { cause: err instanceof Error ? err : undefined }
    );
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
  const { object } = await withTimeout(
    conn.DOM.resolveNode({ backendNodeId }),
    timeout ?? 5_000,
    "clickNode:resolve"
  );
  if (!object.objectId) {
    throw new ElementNotFoundError(`backendNodeId:${backendNodeId}`);
  }

  try {
    await conn.Runtime.callFunctionOn({
      objectId: object.objectId,
      functionDeclaration: "function() { this.click(); }",
      returnByValue: true,
    });
  } finally {
    await conn.Runtime.releaseObject({ objectId: object.objectId }).catch(() => {});
  }
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
  const { object } = await withTimeout(
    conn.DOM.resolveNode({ backendNodeId }),
    timeout ?? 5_000,
    "typeText:resolve"
  );
  if (!object.objectId) {
    throw new ElementNotFoundError(`backendNodeId:${backendNodeId}`);
  }

  try {
    // Focus the element
    await conn.Runtime.callFunctionOn({
      objectId: object.objectId,
      functionDeclaration: "function() { this.focus(); }",
      returnByValue: true,
    });

    if (clear) {
      await conn.Runtime.callFunctionOn({
        objectId: object.objectId,
        functionDeclaration: "function() { this.value = ''; }",
        returnByValue: true,
      });
    }

    // HIGH-002b: Use Input.insertText for fast typing (1 round-trip instead of 2N)
    // This is ~200x faster than per-character dispatchKeyEvent for long strings
    // Type assertion needed because chrome-remote-interface types don't expose insertText
    const Input = conn.Input as unknown as { insertText(params: { text: string }): Promise<void> };
    await Input.insertText({ text });

    // Dispatch input event to trigger any listeners
    await conn.Runtime.callFunctionOn({
      objectId: object.objectId,
      functionDeclaration:
        "function() { this.dispatchEvent(new Event('input', {bubbles: true})); this.dispatchEvent(new Event('change', {bubbles: true})); }",
      returnByValue: true,
    });
  } finally {
    await conn.Runtime.releaseObject({ objectId: object.objectId }).catch(() => {});
  }
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
  const { object } = await withTimeout(
    conn.DOM.resolveNode({ backendNodeId }),
    timeout ?? 5_000,
    "selectOption:resolve"
  );
  if (!object.objectId) {
    throw new ElementNotFoundError(`backendNodeId:${backendNodeId}`);
  }

  try {
    await conn.Runtime.callFunctionOn({
      objectId: object.objectId,
      functionDeclaration: `function() {
        this.value = ${JSON.stringify(value)};
        this.dispatchEvent(new Event('input', {bubbles: true}));
        this.dispatchEvent(new Event('change', {bubbles: true}));
      }`,
      returnByValue: true,
    });
  } finally {
    await conn.Runtime.releaseObject({ objectId: object.objectId }).catch(() => {});
  }
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
  await withTimeout(
    conn.Runtime.evaluate({
      expression: `window.scrollBy(0, ${delta})`,
    }),
    timeout ?? 5_000,
    "scroll"
  );
}

/**
 * Execute JavaScript in the page context
 * HIGH-011: Added null check on result.result
 */
export async function evaluate(
  conn: CDPConnection,
  expression: string,
  timeout?: number
): Promise<unknown> {
  const result = await withTimeout(
    conn.Runtime.evaluate({
      expression,
      returnByValue: true,
      awaitPromise: true,
    }),
    timeout ?? 10_000,
    "evaluate"
  );
  if (result.exceptionDetails) {
    throw new Error(
      `Evaluation failed: ${result.exceptionDetails.text ?? "unknown error"}`
    );
  }
  // HIGH-011: Check if result.result exists before accessing value
  if (!result.result) {
    throw new Error("Evaluation returned no result");
  }
  return result.result.value;
}

/**
 * Wait for the page to be stable using MutationObserver-based approach.
 * Observes DOM changes and waits for a quiet period (no mutations for 300ms).
 * Resolves early (500ms) if no mutations observed at all.
 * Hard timeout cap prevents hanging.
 * Uses a shared observer instance to prevent accumulation (HIGH-013).
 */
export async function waitForStable(
  conn: CDPConnection,
  timeout: number = 5000
): Promise<void> {
  await withTimeout(
    conn.Runtime.evaluate({
      expression: `new Promise(resolve => {
  // Use shared observer on window to prevent accumulation
  if (window.__tidesurf_stable_observer) {
    window.__tidesurf_stable_observer.disconnect();
  }
  let timer = null;
  let resolved = false;
  const done = () => { 
    if (!resolved) { 
      resolved = true; 
      if (window.__tidesurf_stable_observer) {
        window.__tidesurf_stable_observer.disconnect();
        window.__tidesurf_stable_observer = null;
      }
      resolve(); 
    } 
  };
  window.__tidesurf_stable_observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(done, 300);
  });
  window.__tidesurf_stable_observer.observe(document.body || document.documentElement, {
    childList: true, subtree: true, attributes: true, characterData: true
  });
  // Early resolve if no mutations at all within 500ms
  timer = setTimeout(done, 500);
})`,
      awaitPromise: true,
    }),
    timeout,
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
  }
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

  const { data } = await conn.Page.captureScreenshot(params);
  return data;
}

/**
 * Set files on a file input element.
 * HIGH-008: All CDP calls wrapped with timeout
 */
export async function setFileInput(
  conn: CDPConnection,
  backendNodeId: number,
  filePaths: string[],
  timeout?: number
): Promise<void> {
  const operationTimeout = timeout ?? 10_000;

  await withTimeout(
    conn.DOM.setFileInputFiles({ files: filePaths, backendNodeId }),
    operationTimeout,
    "setFileInput: setFileInputFiles"
  );

  // Dispatch a change event so the page reacts
  const { object } = await withTimeout(
    conn.DOM.resolveNode({ backendNodeId }),
    operationTimeout,
    "setFileInput: resolveNode"
  );
  if (object.objectId) {
    try {
      await withTimeout(
        conn.Runtime.callFunctionOn({
          objectId: object.objectId,
          functionDeclaration:
            "function() { this.dispatchEvent(new Event('change', { bubbles: true })); }",
          returnByValue: true,
        }),
        operationTimeout,
        "setFileInput: dispatchEvent"
      );
    } finally {
      await withTimeout(
        conn.Runtime.releaseObject({ objectId: object.objectId }),
        operationTimeout,
        "setFileInput: releaseObject"
      ).catch(() => {});
    }
  }
}

/**
 * Read text from the clipboard.
 * HIGH-020: Rate limited to prevent data exfiltration
 */
export async function clipboardRead(conn: CDPConnection): Promise<string> {
  const now = Date.now();
  const timeSinceLastRead = now - lastClipboardReadTime;

  if (timeSinceLastRead < CLIPBOARD_READ_COOLDOWN_MS) {
    const remaining = Math.ceil((CLIPBOARD_READ_COOLDOWN_MS - timeSinceLastRead) / 1000);
    throw new ValidationError(
      `Clipboard read rate limit exceeded. Please wait ${remaining} second(s) before reading again.`
    );
  }

  const result = await conn.Runtime.evaluate({
    expression: "navigator.clipboard.readText()",
    awaitPromise: true,
    userGesture: true,
    returnByValue: true,
  });

  if (result.exceptionDetails) {
    throw new Error(
      `Clipboard read failed: ${result.exceptionDetails.text ?? "unknown error"}`
    );
  }

  lastClipboardReadTime = Date.now();
  return String(result.result.value ?? "");
}

/**
 * Write text to the clipboard.
 */
export async function clipboardWrite(
  conn: CDPConnection,
  text: string
): Promise<void> {
  const result = await conn.Runtime.evaluate({
    expression: `navigator.clipboard.writeText(${JSON.stringify(text)})`,
    awaitPromise: true,
    userGesture: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(
      `Clipboard write failed: ${result.exceptionDetails.text ?? "unknown error"}`
    );
  }
}

/**
 * Close the CDP connection
 * Properly disables CDP domains before closing (NEW-CDP-004)
 */
export async function disconnect(conn: CDPConnection): Promise<void> {
  try {
    // Disable domains before closing to clean up properly
    // Type assertions needed because chrome-remote-interface types don't expose disable methods
    // Note: DOM.disable(), Page.disable(), Runtime.disable() are called via type assertions
    const DOM = conn.DOM as unknown as { disable(): Promise<void> };
    const Page = conn.Page as unknown as { disable(): Promise<void> };
    const Runtime = conn.Runtime as unknown as { disable(): Promise<void> };
    await Promise.all([
      DOM.disable().catch(() => {}),
      Page.disable().catch(() => {}),
      Runtime.disable().catch(() => {}),
    ]);
  } finally {
    await conn.client.close();
  }
}
