import type { CDPConnection } from "./connection.js";
import type { PageState, NodeMap, GetStateOptions } from "../types.js";
import * as cdp from "./connection.js";
import { walkDOM } from "../parser/dom-walker.js";
import { serializeToXml, wrapPage } from "../parser/xml-serializer.js";
import { markVisibleElements } from "./viewport.js";
import { pruneToFit, estimateTokens } from "../parser/token-budget.js";
import { ElementNotFoundError } from "../errors.js";
import {
  validateUrl,
  validateSelector,
  validateExpression,
  validateElementId,
} from "../validation.js";

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
    // Always clear stale visibility markers to prevent carryover from prior calls
    await cdp.evaluate(
      this.conn,
      "document.querySelectorAll('[data-os-visible]').forEach(el => el.removeAttribute('data-os-visible'))"
    );

    if (options?.maxTokens) {
      await markVisibleElements(this.conn);
    }

    const root = await cdp.getFullDOM(this.conn);

    let { nodes, nodeMap } = walkDOM(root);

    if (options?.maxTokens) {
      nodes = pruneToFit(nodes, { maxTokens: options.maxTokens });
    }

    const xml = serializeToXml(nodes, 1);
    const url = await this.getUrl();
    const title = await this.getTitle();

    // Only update lastNodeMap after all operations succeed
    this.lastNodeMap = nodeMap;

    return {
      url,
      title,
      xml: wrapPage(xml, url, title),
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
