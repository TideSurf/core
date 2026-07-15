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
  CDPNode,
} from "../types.js";
import * as cdp from "./connection.js";
import { walkDOM } from "../parser/dom-walker.js";
import { serialize, wrapPage } from "../parser/serializer.js";
import {
  clearInspectionMarkers,
  inspectPage,
  type PageInspection,
} from "./viewport.js";
import { pruneToFit } from "../parser/token-budget.js";
import { filterViewportOnly } from "../parser/viewport-filter.js";
import { filterInteractive, filterMinimal } from "../parser/mode-filter.js";
import { truncateGraphemes } from "../parser/truncation.js";
import {
  CDPConnectionError,
  ElementNotFoundError,
  ReadOnlyError,
  ValidationError,
} from "../errors.js";
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
  resolveImplicitDownloadRoot,
  type UrlValidationOptions,
} from "../validation.js";
import { downloadFromAction } from "./download-manager.js";
import { withTimeout } from "./timeout.js";

function retainNodeMap(nodes: OSNode[], nodeMap: NodeMap): NodeMap {
  const retained: NodeMap = new Map();
  const visit = (list: OSNode[]) => {
    for (const node of list) {
      if (node.id) {
        const backendNodeId = nodeMap.get(node.id);
        if (backendNodeId !== undefined) {
          retained.set(node.id, backendNodeId);
        }
      }
      if (node.children.length > 0) {
        visit(node.children);
      }
    }
  };

  visit(nodes);
  return retained;
}

/**
 * SurfingPage — high-level page interaction built on CDP
 */
export class SurfingPage {
  private readonly conn: CDPConnection;
  private lastNodeMap: NodeMap = new Map();
  private readonly fileAccessRoots: string[];
  private readonly urlValidationOptions: UrlValidationOptions;
  private readonly readOnly: boolean;
  private readonly timeout?: number;
  private inspectionTail: Promise<void> = Promise.resolve();
  private closePromise: Promise<void> | null = null;

  constructor(
    conn: CDPConnection,
    fileAccessRoots: string[] = resolveFileAccessRoots(),
    urlValidationOptions: UrlValidationOptions = {},
    readOnly: boolean = false,
    timeout?: number
  ) {
    this.conn = conn;
    this.fileAccessRoots = [...fileAccessRoots];
    this.urlValidationOptions = { ...urlValidationOptions };
    this.readOnly = readOnly;
    this.timeout = timeout;
  }

  /**
   * Get compressed page state + nodeMap.
   * @param options - Optional settings (maxTokens for token budgeting)
   * @returns PageState with URL, title, compressed content, and node map
   */
  async getState(options?: GetStateOptions): Promise<PageState> {
    this.assertOpen();
    if (options?.maxTokens !== undefined) {
      validatePositiveInteger(options.maxTokens, "maxTokens");
    }

    return this.runInspection(() => this.readState(options));
  }

  private async readState(options?: GetStateOptions): Promise<PageState> {
    const useViewport = options?.viewport !== false;
    const includeHidden = options?.includeHidden === true;
    const markViewport =
      !includeHidden && (useViewport || options?.maxTokens !== undefined);
    const pageInfo = await inspectPage(this.conn, {
      markViewport,
      markHidden: !includeHidden,
    }, this.timeout);
    const url = pageInfo.url;
    const title = pageInfo.title;

    let scrollPosition: ScrollPosition | undefined;
    if (useViewport && !includeHidden) {
      scrollPosition = {
        scrollY: pageInfo.scrollY,
        scrollHeight: pageInfo.scrollHeight,
        viewportHeight: pageInfo.viewportHeight,
      };
    }

    const root = await this.readInspectedDOM(pageInfo);
    let { nodes, nodeMap } = walkDOM(root, {
      includeHidden,
      markerAttributes: pageInfo.markerAttributes,
      viewportMarked: markViewport,
    });

    let aboveSummary: OSNode | undefined;
    let belowSummary: OSNode | undefined;
    if (useViewport && !includeHidden) {
      const filtered = filterViewportOnly(nodes);
      nodes = filtered.nodes;
      aboveSummary = filtered.aboveSummary;
      belowSummary = filtered.belowSummary;
    }

    if (options?.mode === "interactive") {
      nodes = filterInteractive(nodes);
    } else if (options?.mode === "minimal") {
      nodes = filterMinimal(nodes);
    }

    if (!options?.mode || options.mode === "full") {
      if (aboveSummary) nodes.unshift(aboveSummary);
      if (belowSummary) nodes.push(belowSummary);
    }

    if (options?.maxTokens) {
      nodes = pruneToFit(nodes, { maxTokens: options.maxTokens, pageUrl: url });
    }

    const body = serialize(nodes, 0, url);
    const content = wrapPage(body, url, title, scrollPosition);

    const filteredNodeMap = retainNodeMap(nodes, nodeMap);
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
    this.assertOpen();
    this.assertWritable("click");
    validateElementId(id);
    const backendNodeId = this.getBackendNodeId(id);
    await cdp.clickNode(this.conn, backendNodeId, this.timeout);
    await cdp.waitForStable(this.conn, this.timeout);
  }

  /**
   * Type text into an input by ID.
   * @param id - Input element ID
   * @param text - Text to type
   * @param clear - Whether to clear the field first
   */
  async type(id: string, text: string, clear: boolean = false): Promise<void> {
    this.assertOpen();
    this.assertWritable("type");
    validateElementId(id);
    const backendNodeId = this.getBackendNodeId(id);
    await cdp.typeText(this.conn, backendNodeId, text, clear, this.timeout);
    await cdp.waitForStable(this.conn, this.timeout);
  }

  /**
   * Select an option in a <select> by ID.
   * @param id - Select element ID
   * @param value - Option value to select
   */
  async select(id: string, value: string): Promise<void> {
    this.assertOpen();
    this.assertWritable("select");
    validateElementId(id);
    const backendNodeId = this.getBackendNodeId(id);
    await cdp.selectOption(this.conn, backendNodeId, value, this.timeout);
    await cdp.waitForStable(this.conn, this.timeout);
  }

  /**
   * Scroll the page.
   * @param direction - "up" or "down"
   * @param amount - Pixels to scroll (default 500)
   */
  async scroll(direction: "up" | "down", amount?: number): Promise<void> {
    this.assertOpen();
    this.assertWritable("scroll");
    if (direction !== "up" && direction !== "down") {
      throw new ValidationError('direction must be "up" or "down"');
    }
    if (amount !== undefined) {
      validatePositiveNumber(amount, "amount");
    }
    await cdp.scroll(this.conn, direction, amount, this.timeout);
    await cdp.waitForStable(this.conn, this.timeout);
  }

  /**
   * Wait for the page to settle.
   * @param timeout - Max wait time in ms
   */
  async waitForStable(timeout?: number): Promise<void> {
    this.assertOpen();
    if (timeout !== undefined) {
      validatePositiveInteger(timeout, "timeout");
    }
    await cdp.waitForStable(this.conn, timeout ?? this.timeout);
  }

  /**
   * Extract text content from the page via CSS selector.
   * @param selector - CSS selector
   * @returns Text content of the matched element
   */
  async extract(selector: string): Promise<string> {
    this.assertOpen();
    validateSelector(selector);
    const result = await cdp.evaluate(
      this.conn,
      `document.querySelector(${JSON.stringify(selector)})?.textContent ?? ""`,
      this.timeout
    );
    return String(result);
  }

  /**
   * Navigate to a URL.
   * @param url - Target URL (http/https)
   * @throws {NavigationError} if navigation fails
   */
  async navigate(url: string): Promise<void> {
    this.assertOpen();
    this.assertWritable("navigate");
    validateUrl(url, this.urlValidationOptions);
    await cdp.navigate(this.conn, url, this.timeout);
    await cdp.waitForStable(this.conn, this.timeout);
  }

  /**
   * Execute arbitrary JS in the page.
   * @param expression - JavaScript expression to evaluate
   * @returns Result of the evaluation
   */
  async evaluate(expression: string): Promise<unknown> {
    this.assertOpen();
    this.assertWritable("evaluate");
    validateExpression(expression);
    return cdp.evaluate(this.conn, expression, this.timeout);
  }

  /**
   * Search the page for text matching a query.
   * @param query - Text to search for (case-insensitive)
   * @param maxResults - Maximum number of results (default 10)
   * @returns Array of SearchResult with optional element IDs
   */
  async search(query: string, maxResults: number = 10): Promise<SearchResult[]> {
    this.assertOpen();
    validateSearchQuery(query);
    validatePositiveInteger(maxResults, "maxResults");

    return this.runInspection(() => this.searchPage(query, maxResults));
  }

  private async searchPage(
    query: string,
    maxResults: number
  ): Promise<SearchResult[]> {
    const needle = query.trim().toLowerCase();
    const inspection = await inspectPage(
      this.conn,
      { markViewport: false, markHidden: true },
      this.timeout
    );
    const root = await this.readInspectedDOM(inspection);
    const { nodes, nodeMap: freshNodeMap } = walkDOM(root, {
      truncate: false,
      markerAttributes: inspection.markerAttributes,
    });

    const backendToStableId = new Map<number, string>();
    for (const [id, backendNodeId] of this.lastNodeMap) {
      backendToStableId.set(backendNodeId, id);
    }

    const results: SearchResult[] = [];

    const walk = (node: OSNode, parentTag?: string, nearestId?: string): void => {
      if (results.length >= maxResults) {
        return;
      }

      const currentTag = node.tag === "#text" ? parentTag ?? "text" : node.tag;

      let currentId = nearestId;
      if (node.id) {
        const backendId = freshNodeMap.get(node.id);
        const stableId =
          backendId !== undefined ? backendToStableId.get(backendId) : undefined;
        if (stableId) {
          currentId = stableId;
        }
      }

      const text = node.text?.trim();

      if (text && text.toLowerCase().includes(needle)) {
        results.push({
          text: truncateGraphemes(text, 100),
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

    return results;
  }

  /**
   * Capture a screenshot of the page.
   * @param options - Screenshot options (elementId, fullPage)
   * @returns Base64-encoded PNG string
   */
  async screenshot(options?: ScreenshotOptions): Promise<string> {
    this.assertOpen();
    if (options?.elementId && options.fullPage) {
      throw new ValidationError("screenshot cannot target an element and fullPage at the same time");
    }

    if (options?.elementId) {
      validateElementId(options.elementId);
      const backendNodeId = this.getBackendNodeId(options.elementId);

      const { model } = await withTimeout(
        this.conn.DOM.getBoxModel({ backendNodeId }),
        this.timeout ?? 5_000,
        "screenshot:getBoxModel"
      );
      const content = model.content;
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
      }, this.timeout);
    }

    if (options?.fullPage) {
      const dims = (await cdp.evaluate(
        this.conn,
        "({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight })",
        this.timeout
      )) as { width: number; height: number };

      return cdp.captureScreenshot(this.conn, {
        clip: { x: 0, y: 0, width: dims.width, height: dims.height, scale: 1 },
        fullPage: true,
      }, this.timeout);
    }

    return cdp.captureScreenshot(this.conn, undefined, this.timeout);
  }

  /**
   * Upload files to a file input element.
   * @param id - Element ID of the file input
   * @param filePaths - Array of file paths to upload
   */
  async upload(id: string, filePaths: string[]): Promise<void> {
    this.assertOpen();
    this.assertWritable("upload");
    validateElementId(id);
    const validatedFilePaths = filePaths.map((fp) =>
      validateUploadFilePath(fp, this.fileAccessRoots)
    );
    const backendNodeId = this.getBackendNodeId(id);
    await cdp.setFileInput(this.conn, backendNodeId, validatedFilePaths, this.timeout);
    await cdp.waitForStable(this.conn, this.timeout);
  }

  /**
   * Read text from the clipboard.
   * @returns Clipboard text content
   */
  async clipboardRead(): Promise<string> {
    this.assertOpen();
    this.assertWritable("clipboardRead");
    return cdp.clipboardRead(this.conn, this.timeout);
  }

  /**
   * Write text to the clipboard.
   * @param text - Text to write to clipboard
   */
  async clipboardWrite(text: string): Promise<void> {
    this.assertOpen();
    this.assertWritable("clipboardWrite");
    await cdp.clipboardWrite(this.conn, text, this.timeout);
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
    this.assertOpen();
    this.assertWritable("download");
    validateElementId(id);
    if (options?.timeout !== undefined) {
      validatePositiveInteger(options.timeout, "timeout");
    }
    const backendNodeId = this.getBackendNodeId(id);

    const downloadDir = options?.downloadDir
      ? validateDownloadDirectory(options.downloadDir, this.fileAccessRoots)
      : undefined;
    return downloadFromAction(
      this.conn,
      {
        downloadDir,
        temporaryRoot:
          downloadDir === undefined
            ? resolveImplicitDownloadRoot(this.fileAccessRoots)
            : undefined,
        timeout: options?.timeout ?? this.timeout,
      },
      () => cdp.clickNode(this.conn, backendNodeId, this.timeout)
    );
  }

  /**
   * Close the CDP connection.
   */
  async close(): Promise<void> {
    this.closePromise ??= cdp.disconnect(this.conn);
    return this.closePromise;
  }

  private getBackendNodeId(id: string): number {
    const backendNodeId = this.lastNodeMap.get(id);
    if (backendNodeId === undefined) {
      throw new ElementNotFoundError(id);
    }
    return backendNodeId;
  }

  private assertWritable(operation: string): void {
    if (this.readOnly) throw new ReadOnlyError(operation);
  }

  private assertOpen(): void {
    if (this.closePromise) {
      throw new CDPConnectionError("SurfingPage is closed");
    }
  }

  private async readInspectedDOM(
    inspection: Pick<PageInspection, "elementCount" | "markerAttributes">
  ): Promise<CDPNode> {
    let operationFailed = false;
    try {
      return await cdp.getFullDOM(
        this.conn,
        this.timeout,
        inspection.elementCount
      );
    } catch (error) {
      operationFailed = true;
      throw error;
    } finally {
      if (inspection.elementCount <= cdp.MAX_DOM_NODES) {
        try {
          await clearInspectionMarkers(
            this.conn,
            inspection.markerAttributes,
            this.timeout
          );
        } catch (error) {
          if (!operationFailed) throw error;
        }
      }
    }
  }

  private runInspection<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.inspectionTail.then(() => {
      this.assertOpen();
      return operation();
    });
    this.inspectionTail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}
