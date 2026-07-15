import type { CDPConnection } from "./connection.js";
import type {
  PageState,
  NodeMap,
  ReadPageOptions,
  GetStateOptions,
  ScrollPosition,
  SearchResult,
  ScreenshotOptions,
  DownloadResult,
  OSNode,
} from "../types.js";
import * as cdp from "./connection.js";
import { captureDOMSnapshot } from "./snapshot.js";
import { walkDOM } from "../parser/dom-walker.js";
import { serialize, wrapPage } from "../parser/serializer.js";
import { pruneToFit } from "../parser/token-budget.js";
import { filterViewportOnly } from "../parser/viewport-filter.js";
import { filterInteractive, filterMinimal } from "../parser/mode-filter.js";
import { truncateGraphemes } from "../parser/truncation.js";
import {
  ActionCommittedError,
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
  validatePositiveInteger,
  validatePositiveNumber,
  validateTimeout,
  validateSearchQuery,
  validateUploadFilePath,
  resolveFileAccessRoots,
  resolveImplicitDownloadRoot,
  type UrlValidationOptions,
} from "../validation.js";
import { downloadFromAction } from "./download-manager.js";
import { withTimeout } from "./timeout.js";

const READ_PAGE_MODES = new Set(["full", "minimal", "interactive"]);

function normalizeReadPageOptions(
  options: ReadPageOptions | undefined
): ReadPageOptions {
  if (options === undefined) return {};
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw new ValidationError("Page read options must be an object");
  }
  if (options.maxTokens !== undefined) {
    validatePositiveInteger(options.maxTokens, "maxTokens");
  }
  if (options.viewport !== undefined && typeof options.viewport !== "boolean") {
    throw new ValidationError("viewport must be a boolean");
  }
  if (
    options.includeHidden !== undefined &&
    typeof options.includeHidden !== "boolean"
  ) {
    throw new ValidationError("includeHidden must be a boolean");
  }
  if (options.mode !== undefined && !READ_PAGE_MODES.has(options.mode)) {
    throw new ValidationError("mode must be full, minimal, or interactive");
  }
  return {
    maxTokens: options.maxTokens,
    viewport: options.viewport,
    mode: options.mode,
    includeHidden: options.includeHidden,
  };
}

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

const pageConnections = new WeakMap<SurfingPage, CDPConnection>();
const closingPages = new WeakSet<SurfingPage>();

export function isSurfingPageConnected(page: SurfingPage): boolean {
  return !closingPages.has(page) && pageConnections.get(page)?.disconnected !== true;
}

/** Stateful page inspection and interaction over one CDP target. */
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
    pageConnections.set(this, conn);
    this.fileAccessRoots = [...fileAccessRoots];
    this.urlValidationOptions = { ...urlValidationOptions };
    this.readOnly = readOnly;
    this.timeout = timeout;
  }

  async readPage(options?: ReadPageOptions): Promise<PageState> {
    this.assertOpen();
    const snapshot = normalizeReadPageOptions(options);
    return this.runInspection(() => this.capturePage(snapshot));
  }

  /** @deprecated Use `readPage()`. */
  getState(options?: GetStateOptions): Promise<PageState> {
    return this.readPage(options);
  }

  private async capturePage(options: ReadPageOptions): Promise<PageState> {
    const useViewport = options.viewport !== false;
    const includeHidden = options.includeHidden === true;
    const markViewport =
      !includeHidden && (useViewport || options.maxTokens !== undefined);
    const snapshot = await captureDOMSnapshot(this.conn, {
      markViewport,
      markHidden: !includeHidden,
      timeout: this.timeout,
    });
    const url = snapshot.url;
    const title = snapshot.title;

    let scrollPosition: ScrollPosition | undefined;
    if (useViewport && !includeHidden) {
      scrollPosition = {
        scrollY: snapshot.scrollY,
        scrollHeight: snapshot.scrollHeight,
        viewportHeight: snapshot.viewportHeight,
      };
    }

    let { nodes, nodeMap } = walkDOM(snapshot.root, {
      includeHidden,
      markerAttributes: snapshot.markerAttributes,
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

    if (options.mode === "interactive") {
      nodes = filterInteractive(nodes);
    } else if (options.mode === "minimal") {
      nodes = filterMinimal(nodes);
    }

    if (!options.mode || options.mode === "full") {
      if (aboveSummary) nodes.unshift(aboveSummary);
      if (belowSummary) nodes.push(belowSummary);
    }

    if (options.maxTokens) {
      nodes = pruneToFit(nodes, { maxTokens: options.maxTokens, pageUrl: url });
    }

    const body = serialize(nodes, 0, url);
    const content = wrapPage(body, url, title, scrollPosition);

    this.lastNodeMap = retainNodeMap(nodes, nodeMap);

    return {
      url,
      title,
      content,
      xml: content,
      nodeMap: new Map(this.lastNodeMap),
    };
  }

  async click(id: string): Promise<void> {
    this.assertOpen();
    this.assertWritable("click");
    validateElementId(id);
    const backendNodeId = this.getBackendNodeId(id);
    await cdp.clickNode(this.conn, backendNodeId, this.timeout);
    await this.confirmMutation("Click", () =>
      cdp.waitForStable(this.conn, this.timeout)
    );
  }

  async type(id: string, text: string, clear: boolean = false): Promise<void> {
    this.assertOpen();
    this.assertWritable("type");
    validateElementId(id);
    const backendNodeId = this.getBackendNodeId(id);
    await cdp.typeText(this.conn, backendNodeId, text, clear, this.timeout);
    await this.confirmMutation("Typing", () =>
      cdp.waitForStable(this.conn, this.timeout)
    );
  }

  async select(id: string, value: string): Promise<void> {
    this.assertOpen();
    this.assertWritable("select");
    validateElementId(id);
    const backendNodeId = this.getBackendNodeId(id);
    await cdp.selectOption(this.conn, backendNodeId, value, this.timeout);
    await this.confirmMutation("Selection", () =>
      cdp.waitForStable(this.conn, this.timeout)
    );
  }

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
  }

  async waitForStable(timeout?: number): Promise<void> {
    this.assertOpen();
    if (timeout !== undefined) {
      validateTimeout(timeout);
    }
    await cdp.waitForStable(this.conn, timeout ?? this.timeout);
  }

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

  async navigate(url: string): Promise<void> {
    this.assertOpen();
    this.assertWritable("navigate");
    validateUrl(url, this.urlValidationOptions);
    await cdp.navigate(this.conn, url, this.timeout);
    await this.confirmMutation("Navigation", () =>
      cdp.waitForStable(this.conn, this.timeout)
    );
  }

  async evaluate(expression: string): Promise<unknown> {
    this.assertOpen();
    this.assertWritable("evaluate");
    validateExpression(expression);
    return cdp.evaluate(this.conn, expression, this.timeout, "Evaluation");
  }

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
    const snapshot = await captureDOMSnapshot(this.conn, {
      markViewport: false,
      markHidden: true,
      timeout: this.timeout,
    });
    const { nodes, nodeMap: freshNodeMap } = walkDOM(snapshot.root, {
      truncate: false,
      markerAttributes: snapshot.markerAttributes,
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

  async screenshot(options?: ScreenshotOptions): Promise<string> {
    this.assertOpen();
    if (options?.elementId !== undefined && options.fullPage) {
      throw new ValidationError("screenshot cannot target an element and fullPage at the same time");
    }

    if (options?.elementId !== undefined) {
      validateElementId(options.elementId);
      const backendNodeId = this.getBackendNodeId(options.elementId);

      const { model } = await withTimeout(
        this.conn.DOM.getBoxModel({ backendNodeId }),
        this.timeout ?? 5_000,
        "screenshot:getBoxModel"
      );
      const border = model.border;
      const x = Math.min(border[0], border[2], border[4], border[6]);
      const y = Math.min(border[1], border[3], border[5], border[7]);
      const maxX = Math.max(border[0], border[2], border[4], border[6]);
      const maxY = Math.max(border[1], border[3], border[5], border[7]);

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

  async upload(id: string, filePaths: string[]): Promise<void> {
    this.assertOpen();
    this.assertWritable("upload");
    validateElementId(id);
    const validatedFilePaths = filePaths.map((fp) =>
      validateUploadFilePath(fp, this.fileAccessRoots)
    );
    const backendNodeId = this.getBackendNodeId(id);
    await cdp.setFileInput(this.conn, backendNodeId, validatedFilePaths, this.timeout);
    await this.confirmMutation("Upload", () =>
      cdp.waitForStable(this.conn, this.timeout)
    );
  }

  async clipboardRead(): Promise<string> {
    this.assertOpen();
    this.assertWritable("clipboardRead");
    return cdp.clipboardRead(this.conn, this.timeout);
  }

  async clipboardWrite(text: string): Promise<void> {
    this.assertOpen();
    this.assertWritable("clipboardWrite");
    await cdp.clipboardWrite(this.conn, text, this.timeout);
  }

  async download(
    id: string,
    options?: { downloadDir?: string; timeout?: number }
  ): Promise<DownloadResult> {
    this.assertOpen();
    this.assertWritable("download");
    validateElementId(id);
    if (options?.timeout !== undefined) {
      validateTimeout(options.timeout);
    }
    const backendNodeId = this.getBackendNodeId(id);

    const downloadDir = options?.downloadDir;
    return downloadFromAction(
      this.conn,
      {
        downloadDir,
        temporaryRoot:
          downloadDir === undefined
            ? resolveImplicitDownloadRoot(this.fileAccessRoots)
            : undefined,
        fileAccessRoots: this.fileAccessRoots,
        timeout: options?.timeout ?? this.timeout,
      },
      () => cdp.clickNode(this.conn, backendNodeId, this.timeout)
    );
  }

  async close(): Promise<void> {
    if (this.closePromise === null) {
      closingPages.add(this);
      this.closePromise = this.conn.disconnected
        ? Promise.resolve()
        : cdp.disconnect(this.conn);
    }
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
    if (this.closePromise || this.conn.disconnected) {
      throw new CDPConnectionError("SurfingPage is closed");
    }
  }

  private async confirmMutation(
    operation: string,
    confirm: () => Promise<void>
  ): Promise<void> {
    try {
      await confirm();
    } catch (error) {
      throw new ActionCommittedError(operation, error);
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
