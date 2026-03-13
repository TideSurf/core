import CDP, { type Client } from "chrome-remote-interface";
import type { CDPNode } from "../types.js";
import { CDPConnectionError, ElementNotFoundError, NavigationError, TideSurfError } from "../errors.js";
import { withTimeout } from "./timeout.js";

export interface CDPConnection {
  client: Client;
  DOM: Client["DOM"];
  Page: Client["Page"];
  Runtime: Client["Runtime"];
  Input: Client["Input"];
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
      }),
      options.timeout ?? 10_000,
      "CDP connect"
    );

    const { DOM, Page, Runtime, Input } = client;

    await Promise.all([DOM.enable(), Page.enable(), Runtime.enable()]);

    return { client, DOM, Page, Runtime, Input };
  } catch (err) {
    if (err instanceof TideSurfError) throw err;
    throw new CDPConnectionError(
      `Failed to connect to Chrome CDP: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err instanceof Error ? err : undefined }
    );
  }
}

/**
 * Get the full DOM tree (pierces shadow DOM)
 */
export async function getFullDOM(conn: CDPConnection, timeout?: number): Promise<CDPNode> {
  const { root } = await withTimeout(
    conn.DOM.getDocument({ depth: -1, pierce: true }),
    timeout ?? 15_000,
    "getFullDOM"
  );
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

    // Type each character via Input.dispatchKeyEvent
    for (const char of text) {
      await conn.Input.dispatchKeyEvent({
        type: "keyDown",
        text: char,
      });
      await conn.Input.dispatchKeyEvent({
        type: "keyUp",
        text: char,
      });
    }

    // Dispatch input event
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
  amount: number = 500
): Promise<void> {
  const delta = direction === "down" ? amount : -amount;
  await conn.Runtime.evaluate({
    expression: `window.scrollBy(0, ${delta})`,
  });
}

/**
 * Execute JavaScript in the page context
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
  return result.result.value;
}

/**
 * Wait for the page to be stable using MutationObserver-based approach.
 * Observes DOM changes and waits for a quiet period (no mutations for 300ms).
 * Resolves early (500ms) if no mutations observed at all.
 * Hard timeout cap prevents hanging.
 */
export async function waitForStable(
  conn: CDPConnection,
  timeout: number = 5000
): Promise<void> {
  await withTimeout(
    conn.Runtime.evaluate({
      expression: `new Promise(resolve => {
  let timer = null;
  let resolved = false;
  const done = () => { if (!resolved) { resolved = true; observer.disconnect(); resolve(); } };
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(done, 300);
  });
  observer.observe(document.body || document.documentElement, {
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
 */
export async function setFileInput(
  conn: CDPConnection,
  backendNodeId: number,
  filePaths: string[]
): Promise<void> {
  await conn.DOM.setFileInputFiles({ files: filePaths, backendNodeId });

  // Dispatch a change event so the page reacts
  const { object } = await conn.DOM.resolveNode({ backendNodeId });
  if (object.objectId) {
    try {
      await conn.Runtime.callFunctionOn({
        objectId: object.objectId,
        functionDeclaration:
          "function() { this.dispatchEvent(new Event('change', { bubbles: true })); }",
        returnByValue: true,
      });
    } finally {
      await conn.Runtime.releaseObject({ objectId: object.objectId }).catch(() => {});
    }
  }
}

/**
 * Read text from the clipboard.
 */
export async function clipboardRead(conn: CDPConnection): Promise<string> {
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
 * Search the page for text matching a query.
 * Returns matching text contexts with tag names.
 */
export async function searchPage(
  conn: CDPConnection,
  query: string,
  maxResults: number = 10
): Promise<Array<{ text: string; tag: string; index: number }>> {
  const result = await conn.Runtime.evaluate({
    expression: `(() => {
  const query = ${JSON.stringify(query)}.toLowerCase();
  const max = ${maxResults};
  const results = [];
  const walker = document.createTreeWalker(
    document.body || document.documentElement,
    NodeFilter.SHOW_TEXT,
    null
  );
  let index = 1;
  let node;
  while ((node = walker.nextNode()) && results.length < max) {
    const text = node.textContent || "";
    if (text.toLowerCase().includes(query)) {
      const parent = node.parentElement;
      if (parent) {
        const context = text.trim().substring(0, 100);
        if (context) {
          results.push({
            text: context,
            tag: parent.tagName.toLowerCase(),
            index: index++,
          });
        }
      }
    }
  }
  return results;
})()`,
    returnByValue: true,
    awaitPromise: false,
  });
  if (result.exceptionDetails) {
    throw new Error(
      `Search failed: ${result.exceptionDetails.text ?? "unknown error"}`
    );
  }
  return (result.result.value as Array<{ text: string; tag: string; index: number }>) ?? [];
}

/**
 * Close the CDP connection
 */
export async function disconnect(conn: CDPConnection): Promise<void> {
  await conn.client.close();
}
