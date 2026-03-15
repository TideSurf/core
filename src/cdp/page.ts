import type { CDPConnection } from "./connection.js";
import type {
  PageState,
  NodeMap,
  GetStateOptions,
  ScrollPosition,
  SearchResult,
  ScreenshotOptions,
  DownloadResult,
  OSNode,
} from "../types.js";
import * as cdp from "./connection.js";
import { walkDOM } from "../parser/dom-walker.js";
import { serialize, wrapPage } from "../parser/serializer.js";
import { markVisibleElements, getScrollPosition } from "./viewport.js";
import { pruneToFit } from "../parser/token-budget.js";
import { filterViewportOnly } from "../parser/viewport-filter.js";
import { filterInteractive, filterMinimal } from "../parser/mode-filter.js";
import { deduplicateSiblings } from "../parser/dedup.js";
import { ElementNotFoundError, ValidationError } from "../errors.js";
import {
  validateUrl,
  validateSelector,
  validateExpression,
  validateElementId,
  validateDownloadDirectory,
  validatePositiveInteger,
  validatePositiveNumber,
  validateSearchQuery,
  validateUploadFilePath,
  resolveFileAccessRoots,
} from "../validation.js";
import { setupDownloads, downloadFile } from "./download-manager.js";

function collectVisibleIds(nodes: OSNode[]): Set<string> {
  const ids = new Set<string>();

  const visit = (list: OSNode[]) => {
    for (const node of list) {
      if (node.id) {
        ids.add(node.id);
      }
      if (node.attributes["id"]) {
        ids.add(node.attributes["id"]);
      }
      if (node.children.length > 0) {
        visit(node.children);
      }
    }
  };

  visit(nodes);
  return ids;
}

/**
 * SurfingPage — high-level page interaction built on CDP
 */
export class SurfingPage {
  private conn: CDPConnection;
  private lastNodeMap: NodeMap = new Map();
  private fileAccessRoots: string[];

  constructor(
    conn: CDPConnection,
    fileAccessRoots: string[] = resolveFileAccessRoots()
  ) {
    this.conn = conn;
    this.fileAccessRoots = fileAccessRoots;
  }

  /**
   * Get compressed page state + nodeMap.
   * @param options - Optional settings (maxTokens for token budgeting)
   * @returns PageState with url, title, xml, and nodeMap
   */
  async getState(options?: GetStateOptions): Promise<PageState> {
    if (options?.maxTokens !== undefined) {
      validatePositiveInteger(options.maxTokens, "maxTokens");
    }

    // 1. Clear stale visibility markers to prevent carryover from prior calls
    await cdp.evaluate(
      this.conn,
      "document.querySelectorAll('[data-os-visible]').forEach(el => el.removeAttribute('data-os-visible'))"
    );

    // 2. Viewport defaults to true
    const useViewport = options?.viewport !== false;

    // 3. Mark visible elements if viewport mode or maxTokens is set
    if (useViewport || options?.maxTokens) {
      await markVisibleElements(this.conn);
    }

    // 4. Get URL and scroll position before DOM fetch (needed for serialization)
    const url = await this.getUrl();
    const title = await this.getTitle();

    let scrollPosition: ScrollPosition | undefined;
    if (useViewport) {
      scrollPosition = await getScrollPosition(this.conn);
    }

    // 5. Get full DOM
    const root = await cdp.getFullDOM(this.conn);

    // 6. Walk DOM
    let { nodes, nodeMap } = walkDOM(root);

    // 6b. Deduplicate repeating sibling patterns
    nodes = deduplicateSiblings(nodes);

    // 7. If viewport mode, filter to visible subtrees only
    let aboveSummary: OSNode | undefined;
    let belowSummary: OSNode | undefined;
    if (useViewport) {
      const filtered = filterViewportOnly(nodes);
      nodes = filtered.nodes;
      aboveSummary = filtered.aboveSummary;
      belowSummary = filtered.belowSummary;
    }

    // 8. Apply mode filters
    if (options?.mode === "interactive") {
      nodes = filterInteractive(nodes);
    } else if (options?.mode === "minimal") {
      nodes = filterMinimal(nodes);
    }

    // 9. Prepend/append off-screen summaries (only in full mode)
    if (!options?.mode || options.mode === "full") {
      if (aboveSummary) nodes.unshift(aboveSummary);
      if (belowSummary) nodes.push(belowSummary);
    }

    // 10. If maxTokens, prune to fit budget (after summaries so they count)
    if (options?.maxTokens) {
      nodes = pruneToFit(nodes, { maxTokens: options.maxTokens });
    }

    // 11. Serialize
    const body = serialize(nodes, 0, url);
    const content = wrapPage(body, url, title, scrollPosition);

    const visibleIds = collectVisibleIds(nodes);
    const filteredNodeMap: NodeMap = new Map();
    for (const id of visibleIds) {
      const backendNodeId = nodeMap.get(id);
      if (backendNodeId !== undefined) {
        filteredNodeMap.set(id, backendNodeId);
      }
    }

    // Only update lastNodeMap after all operations succeed
    this.lastNodeMap = filteredNodeMap;

    return {
      url,
      title,
      content,
      xml: content,
      nodeMap: filteredNodeMap,
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
    if (amount !== undefined) {
      validatePositiveNumber(amount, "amount");
    }
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
    validateSearchQuery(query);
    validatePositiveInteger(maxResults, "maxResults");
    const needle = query.trim().toLowerCase();
    const { nodes, nodeMap } = walkDOM(await cdp.getFullDOM(this.conn), { truncate: false });
    const results: SearchResult[] = [];

    const walk = (node: OSNode, parentTag?: string, nearestId?: string): void => {
      if (results.length >= maxResults) {
        return;
      }

      const currentTag = node.tag === "#text" ? parentTag ?? "text" : node.tag;
      const currentId = node.id ?? nearestId;
      const text = node.text?.trim();

      if (text && text.toLowerCase().includes(needle)) {
        results.push({
          text: text.slice(0, 100),
          tag: currentTag,
          index: results.length + 1,
          elementId: currentId,
        });
      }

      for (const child of node.children) {
        walk(child, currentTag, currentId);
        if (results.length >= maxResults) {
          return;
        }
      }
    };

    for (const node of nodes) {
      walk(node);
      if (results.length >= maxResults) {
        break;
      }
    }

    this.lastNodeMap = nodeMap;
    return results;
  }

  /**
   * Capture a screenshot of the page.
   * @param options - Screenshot options (elementId, fullPage)
   * @returns Base64-encoded PNG string
   */
  async screenshot(options?: ScreenshotOptions): Promise<string> {
    if (options?.elementId && options.fullPage) {
      throw new ValidationError("screenshot cannot target an element and fullPage at the same time");
    }

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
    const validatedFilePaths = filePaths.map((fp) =>
      validateUploadFilePath(fp, this.fileAccessRoots)
    );
    const backendNodeId = this.resolveId(id);
    await cdp.setFileInput(this.conn, backendNodeId, validatedFilePaths);
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
    if (options?.timeout !== undefined) {
      validatePositiveInteger(options.timeout, "timeout");
    }
    const backendNodeId = this.resolveId(id);

    const downloadDir = await setupDownloads(
      this.conn,
      options?.downloadDir
        ? validateDownloadDirectory(options.downloadDir, this.fileAccessRoots)
        : undefined
    );
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
