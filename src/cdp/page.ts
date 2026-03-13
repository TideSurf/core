import type { CDPConnection } from "./connection.js";
import type {
  PageState,
  NodeMap,
  GetStateOptions,
  ScrollPosition,
  SearchResult,
  ScreenshotOptions,
  DownloadResult,
} from "../types.js";
import * as cdp from "./connection.js";
import { walkDOM } from "../parser/dom-walker.js";
import { serializeToXml, wrapPage } from "../parser/xml-serializer.js";
import { markVisibleElements, getScrollPosition } from "./viewport.js";
import { pruneToFit, estimateTokens } from "../parser/token-budget.js";
import { filterViewportOnly } from "../parser/viewport-filter.js";
import { filterInteractive, filterMinimal } from "../parser/mode-filter.js";
import { ElementNotFoundError } from "../errors.js";
import {
  validateUrl,
  validateSelector,
  validateExpression,
  validateElementId,
  validateFilePath,
} from "../validation.js";
import { setupDownloads, downloadFile } from "./download-manager.js";

/**
 * SurfingPage — high-level page interaction built on CDP
 */
export class SurfingPage {
  private conn: CDPConnection;
  private lastNodeMap: NodeMap = new Map();

  constructor(conn: CDPConnection) {
    this.conn = conn;
  }

  /**
   * Get compressed page state as XML + nodeMap.
   * @param options - Optional settings (maxTokens for token budgeting)
   * @returns PageState with url, title, xml, and nodeMap
   */
  async getState(options?: GetStateOptions): Promise<PageState> {
    // 1. Clear stale visibility markers to prevent carryover from prior calls
    await cdp.evaluate(
      this.conn,
      "document.querySelectorAll('[data-os-visible]').forEach(el => el.removeAttribute('data-os-visible'))"
    );

    // 2. Mark visible elements if viewport mode or maxTokens is set
    if (options?.viewport || options?.maxTokens) {
      await markVisibleElements(this.conn);
    }

    // 3. Get full DOM
    const root = await cdp.getFullDOM(this.conn);

    // 4. Walk DOM
    let { nodes, nodeMap } = walkDOM(root);

    // 5. If viewport mode, filter to visible subtrees only
    if (options?.viewport) {
      nodes = filterViewportOnly(nodes);
    }

    // 6. Apply mode filters
    if (options?.mode === "interactive") {
      nodes = filterInteractive(nodes);
    } else if (options?.mode === "minimal") {
      nodes = filterMinimal(nodes);
    }

    // 7. If maxTokens, prune to fit budget
    if (options?.maxTokens) {
      nodes = pruneToFit(nodes, { maxTokens: options.maxTokens });
    }

    // 8. Serialize
    const xml = serializeToXml(nodes, 1);
    const url = await this.getUrl();
    const title = await this.getTitle();

    // 9. If viewport mode, get scroll position for page wrapper
    let scrollPosition: ScrollPosition | undefined;
    if (options?.viewport) {
      scrollPosition = await getScrollPosition(this.conn);
    }

    // Only update lastNodeMap after all operations succeed
    this.lastNodeMap = nodeMap;

    return {
      url,
      title,
      xml: wrapPage(xml, url, title, scrollPosition),
      nodeMap,
    };
  }

  /**
   * Click an element by its assigned ID (e.g. "B1", "L3").
   * @param id - Element ID from getState output
   * @throws {ElementNotFoundError} if ID is not in the current node map
   */
  async click(id: string): Promise<void> {
    validateElementId(id);
    const backendNodeId = this.resolveId(id);
    await cdp.clickNode(this.conn, backendNodeId);
    await cdp.waitForStable(this.conn);
  }

  /**
   * Type text into an input by ID.
   * @param id - Input element ID
   * @param text - Text to type
   * @param clear - Whether to clear the field first
   */
  async type(id: string, text: string, clear: boolean = false): Promise<void> {
    validateElementId(id);
    const backendNodeId = this.resolveId(id);
    await cdp.typeText(this.conn, backendNodeId, text, clear);
  }

  /**
   * Select an option in a <select> by ID.
   * @param id - Select element ID
   * @param value - Option value to select
   */
  async select(id: string, value: string): Promise<void> {
    validateElementId(id);
    const backendNodeId = this.resolveId(id);
    await cdp.selectOption(this.conn, backendNodeId, value);
  }

  /**
   * Scroll the page.
   * @param direction - "up" or "down"
   * @param amount - Pixels to scroll (default 500)
   */
  async scroll(direction: "up" | "down", amount?: number): Promise<void> {
    await cdp.scroll(this.conn, direction, amount);
    await cdp.waitForStable(this.conn);
  }

  /**
   * Wait for the page to settle.
   * @param timeout - Max wait time in ms
   */
  async waitForStable(timeout?: number): Promise<void> {
    await cdp.waitForStable(this.conn, timeout);
  }

  /**
   * Extract text content from the page via CSS selector.
   * @param selector - CSS selector
   * @returns Text content of the matched element
   */
  async extract(selector: string): Promise<string> {
    validateSelector(selector);
    const result = await cdp.evaluate(
      this.conn,
      `document.querySelector(${JSON.stringify(selector)})?.textContent ?? ""`
    );
    return String(result);
  }

  /**
   * Navigate to a URL.
   * @param url - Target URL (http/https)
   * @throws {NavigationError} if navigation fails
   */
  async navigate(url: string): Promise<void> {
    validateUrl(url);
    await cdp.navigate(this.conn, url);
    await cdp.waitForStable(this.conn);
  }

  /**
   * Execute arbitrary JS in the page.
   * @param expression - JavaScript expression to evaluate
   * @returns Result of the evaluation
   */
  async evaluate(expression: string): Promise<unknown> {
    validateExpression(expression);
    return cdp.evaluate(this.conn, expression);
  }

  /**
   * Search the page for text matching a query.
   * @param query - Text to search for (case-insensitive)
   * @param maxResults - Maximum number of results (default 10)
   * @returns Array of SearchResult with optional element IDs
   */
  async search(query: string, maxResults: number = 10): Promise<SearchResult[]> {
    const rawResults = await cdp.searchPage(this.conn, query, maxResults);

    // Build a reverse map: backendNodeId -> element ID
    // We can't directly map JS results to backendNodeIds, but we can
    // check text matches against our nodeMap-based elements
    const results: SearchResult[] = rawResults.map((r) => ({
      text: r.text,
      tag: r.tag,
      index: r.index,
      elementId: undefined,
    }));

    return results;
  }

  /**
   * Capture a screenshot of the page.
   * @param options - Screenshot options (elementId, fullPage)
   * @returns Base64-encoded PNG string
   */
  async screenshot(options?: ScreenshotOptions): Promise<string> {
    if (options?.elementId) {
      validateElementId(options.elementId);
      const backendNodeId = this.resolveId(options.elementId);

      // Get box model for the element to create a clip region
      const { model } = await this.conn.DOM.getBoxModel({ backendNodeId });
      const content = model.content;
      // content is [x1,y1, x2,y2, x3,y3, x4,y4] — use bounding box
      const x = Math.min(content[0], content[2], content[4], content[6]);
      const y = Math.min(content[1], content[3], content[5], content[7]);
      const maxX = Math.max(content[0], content[2], content[4], content[6]);
      const maxY = Math.max(content[1], content[3], content[5], content[7]);

      return cdp.captureScreenshot(this.conn, {
        clip: {
          x,
          y,
          width: maxX - x,
          height: maxY - y,
          scale: 1,
        },
      });
    }

    if (options?.fullPage) {
      // Get full document dimensions for the clip region
      const dims = (await cdp.evaluate(
        this.conn,
        "({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight })"
      )) as { width: number; height: number };

      return cdp.captureScreenshot(this.conn, {
        clip: { x: 0, y: 0, width: dims.width, height: dims.height, scale: 1 },
        fullPage: true,
      });
    }

    return cdp.captureScreenshot(this.conn);
  }

  /**
   * Upload files to a file input element.
   * @param id - Element ID of the file input
   * @param filePaths - Array of file paths to upload
   */
  async upload(id: string, filePaths: string[]): Promise<void> {
    validateElementId(id);
    for (const fp of filePaths) {
      validateFilePath(fp);
    }
    const backendNodeId = this.resolveId(id);
    await cdp.setFileInput(this.conn, backendNodeId, filePaths);
    await cdp.waitForStable(this.conn);
  }

  /**
   * Read text from the clipboard.
   * @returns Clipboard text content
   */
  async clipboardRead(): Promise<string> {
    return cdp.clipboardRead(this.conn);
  }

  /**
   * Write text to the clipboard.
   * @param text - Text to write to clipboard
   */
  async clipboardWrite(text: string): Promise<void> {
    await cdp.clipboardWrite(this.conn, text);
  }

  /**
   * Download a file by clicking an element.
   * Sets up download handling, clicks the element, and waits for download.
   * @param id - Element ID of the download link/button
   * @param options - Download options (downloadDir, timeout)
   * @returns DownloadResult with file path, name, and size
   */
  async download(
    id: string,
    options?: { downloadDir?: string; timeout?: number }
  ): Promise<DownloadResult> {
    validateElementId(id);
    const backendNodeId = this.resolveId(id);

    const downloadDir = await setupDownloads(this.conn, options?.downloadDir);
    const downloadPromise = downloadFile(
      this.conn,
      downloadDir,
      options?.timeout
    );

    // Click the element to trigger the download
    await cdp.clickNode(this.conn, backendNodeId);

    return downloadPromise;
  }

  /**
   * Close the CDP connection.
   */
  async close(): Promise<void> {
    await cdp.disconnect(this.conn);
  }

  private resolveId(id: string): number {
    const backendNodeId = this.lastNodeMap.get(id);
    if (backendNodeId === undefined) {
      throw new ElementNotFoundError(id);
    }
    return backendNodeId;
  }

  private async getUrl(): Promise<string> {
    const result = await cdp.evaluate(this.conn, "window.location.href");
    return String(result);
  }

  private async getTitle(): Promise<string> {
    const result = await cdp.evaluate(this.conn, "document.title");
    return String(result);
  }
}
