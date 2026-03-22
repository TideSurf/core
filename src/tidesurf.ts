import type { ChildProcess } from "node:child_process";
import type { TideSurfOptions, TideSurfConnectOptions, ToolResult, GetStateOptions, PageState } from "./types.js";
import { launchChrome, discoverBrowser } from "./cdp/launcher.js";
import { connect } from "./cdp/connection.js";
import { SurfingPage } from "./cdp/page.js";
import { TabManager, type TabInfo } from "./cdp/tab-manager.js";
import { createToolExecutor } from "./tools/executor.js";
import { getToolDefinitions } from "./tools/definitions.js";
import { withRetry } from "./cdp/retry.js";
import { rmSync } from "node:fs";
import { applyViewport } from "./cdp/viewport.js";
import { resolveFileAccessRoots } from "./validation.js";
import { ReadOnlyError } from "./errors.js";

/**
 * Main entry point for TideSurf.
 * Launches Chrome, connects via CDP, and provides page interaction + tool execution.
 */
export class TideSurf {
  private chromeProcess: ChildProcess | null;
  private activePage: SurfingPage;
  private pages: Map<string, SurfingPage> = new Map();
  private tabManager: TabManager;
  private executor: (tool: {
    name: string;
    input: Record<string, unknown>;
  }) => Promise<ToolResult>;
  private userDataDir: string;
  private ownsTempDir: boolean;
  private port: number;
  private readOnly: boolean;
  private defaultViewport?: TideSurfOptions["defaultViewport"];
  private fileAccessRoots: string[];
  private exitHandler: (() => void) | null = null;
  private activeTabId: string | null;

  private constructor(
    chromeProcess: ChildProcess | null,
    page: SurfingPage,
    tabManager: TabManager,
    userDataDir: string,
    ownsTempDir: boolean,
    port: number,
    readOnly: boolean = false,
    activeTabId: string | null = null,
    defaultViewport?: TideSurfOptions["defaultViewport"],
    fileAccessRoots: string[] = resolveFileAccessRoots()
  ) {
    this.chromeProcess = chromeProcess;
    this.activePage = page;
    this.tabManager = tabManager;
    this.userDataDir = userDataDir;
    this.ownsTempDir = ownsTempDir;
    this.port = port;
    this.readOnly = readOnly;
    this.activeTabId = activeTabId;
    this.defaultViewport = defaultViewport;
    this.fileAccessRoots = fileAccessRoots;
    this.executor = createToolExecutor(this, this.readOnly);

    if (activeTabId) {
      this.pages.set(activeTabId, page);
    }

    // Register exit handler to kill Chrome if parent dies (only if we own the process)
    if (chromeProcess) {
      this.exitHandler = () => {
        try {
          this.chromeProcess?.kill();
        } catch {
          // ignore
        }
      };
      process.on("exit", this.exitHandler);
    }
  }

  /**
   * Launch Chrome and connect. Returns a ready-to-use TideSurf instance.
   * @param options - Launch configuration
   * @returns Ready TideSurf instance
   * @throws {ChromeLaunchError} if Chrome cannot be started
   * @throws {CDPConnectionError} if CDP connection fails
   */
  static async launch(options: TideSurfOptions = {}): Promise<TideSurf> {
    const fileAccessRoots = resolveFileAccessRoots(options.fileAccessRoots);
    const { process: proc, port, userDataDir, ownsTempDir } = await withRetry(
      () =>
        launchChrome({
          headless: options.headless ?? true,
          chromePath: options.chromePath,
          port: options.port,
          userDataDir: options.userDataDir,
        }),
      { maxAttempts: 3 }
    );

    const { targetId } = await withRetry(
      () => discoverBrowser({ port, timeout: options.timeout }),
      { maxAttempts: 3 }
    );
    const conn = await withRetry(
      () => connect({ port, tab: targetId, timeout: options.timeout }),
      { maxAttempts: 3 }
    );
    if (options.defaultViewport) {
      await applyViewport(conn, options.defaultViewport);
    }
    const page = new SurfingPage(conn, fileAccessRoots);
    const tabManager = new TabManager(port);

    return new TideSurf(
      proc,
      page,
      tabManager,
      userDataDir,
      ownsTempDir,
      port,
      options.readOnly ?? false,
      targetId,
      options.defaultViewport,
      fileAccessRoots
    );
  }

  /**
   * Connect to an already-running Chrome instance.
   * Does not launch or manage the Chrome process lifecycle.
   *
   * Requires Chrome to have remote debugging enabled:
   *   - Chrome 144+: enable via chrome://inspect#remote-debugging
   *   - Any Chrome: launch with --remote-debugging-port=9222
   *
   * @param options - Connection configuration
   * @returns Ready TideSurf instance
   * @throws {CDPConnectionError} if no Chrome instance is found
   */
  static async connect(options: TideSurfConnectOptions = {}): Promise<TideSurf> {
    const fileAccessRoots = resolveFileAccessRoots(options.fileAccessRoots);
    const { port, host, targetId } = await withRetry(
      () => discoverBrowser({
        port: options.port,
        host: options.host,
        timeout: options.timeout,
      }),
      { maxAttempts: 3 }
    );

    const conn = await withRetry(
      () => connect({ port, host, tab: targetId, timeout: options.timeout }),
      { maxAttempts: 3 }
    );
    if (options.defaultViewport) {
      await applyViewport(conn, options.defaultViewport);
    }
    const page = new SurfingPage(conn, fileAccessRoots);
    const tabManager = new TabManager(port, host);

    return new TideSurf(
      null,
      page,
      tabManager,
      "",
      false,
      port,
      options.readOnly ?? false,
      targetId,
      options.defaultViewport,
      fileAccessRoots
    );
  }

  /**
   * Navigate the active page to a URL.
   * @param url - Target URL
   * @throws {ReadOnlyError} if this instance is in read-only mode
   */
  async navigate(url: string): Promise<void> {
    if (this.readOnly) {
      throw new ReadOnlyError("navigate");
    }
    await this.activePage.navigate(url);
  }

  /**
   * Get the compressed page state of the active page.
   * @param options - Optional settings (maxTokens for token budgeting)
   */
  async getState(options?: GetStateOptions): Promise<PageState> {
    return this.activePage.getState(options);
  }

  /**
   * Get the active SurfingPage instance.
   */
  getPage(): SurfingPage {
    return this.activePage;
  }

  /**
   * Get the tool executor function.
   */
  getToolExecutor() {
    return this.executor;
  }

  /**
   * Get tool definitions for LLM function calling.
   */
  getToolDefinitions() {
    return getToolDefinitions({ readOnly: this.readOnly });
  }

  /**
   * Whether this instance is in read-only mode.
   */
  isReadOnly(): boolean {
    return this.readOnly;
  }

  // --- Tab management ---

  /**
   * List all open tabs.
   */
  async listTabs(): Promise<TabInfo[]> {
    return this.tabManager.listTabs();
  }

  /**
   * Open a new tab, optionally navigating to a URL.
   * @param url - Optional URL to navigate to
   * @returns Info about the new tab
   */
  async newTab(url?: string): Promise<TabInfo> {
    const tab = await this.tabManager.createTab(url);
    const conn = await this.tabManager.connectToTab(tab.id);
    if (this.defaultViewport) {
      await applyViewport(conn, this.defaultViewport);
    }
    const page = new SurfingPage(conn, this.fileAccessRoots);
    this.pages.set(tab.id, page);
    this.activePage = page;
    this.activeTabId = tab.id;
    this.executor = createToolExecutor(this, this.readOnly);
    return tab;
  }

  /**
   * Switch the active tab.
   * @param tabId - Target tab ID
   */
  async switchTab(tabId: string): Promise<void> {
    let page = this.pages.get(tabId);
    if (!page) {
      const conn = await this.tabManager.connectToTab(tabId);
      if (this.defaultViewport) {
        await applyViewport(conn, this.defaultViewport);
      }
      page = new SurfingPage(conn, this.fileAccessRoots);
      this.pages.set(tabId, page);
    }
    this.activePage = page;
    this.activeTabId = tabId;
    this.executor = createToolExecutor(this, this.readOnly);
  }

  /**
   * Close a tab by ID.
   * If closing the active tab, switches to the first remaining tab.
   * @param tabId - Tab to close
   */
  async closeTab(tabId: string): Promise<void> {
    const page = this.pages.get(tabId);
    const isActiveTab = tabId === this.activeTabId;

    if (page) {
      try {
        await page.close();
      } catch {
        // ignore
      }
      this.pages.delete(tabId);
    }
    await this.tabManager.closeTab(tabId);

    // If we closed the active tab, switch to another open tab
    if (isActiveTab) {
      const remaining = await this.tabManager.listTabs();
      if (remaining.length > 0) {
        await this.switchTab(remaining[0].id);
      } else {
        await this.newTab("about:blank");
      }
    }
  }

  /**
   * Gracefully close Chrome and clean up resources.
   * SIGTERM → wait 5s → SIGKILL, then cleanup temp dir.
   */
  async close(): Promise<void> {
    // Unregister exit handler
    if (this.exitHandler) {
      process.removeListener("exit", this.exitHandler);
      this.exitHandler = null;
    }

    // Close all tracked pages (may include the active page)
    const closedPages = new Set<SurfingPage>();
    for (const page of this.pages.values()) {
      try {
        await page.close();
      } catch {
        // ignore
      }
      closedPages.add(page);
    }
    this.pages.clear();

    // Close the active page if it wasn't already closed above
    if (!closedPages.has(this.activePage)) {
      try {
        await this.activePage.close();
      } catch {
        // Connection may already be closed
      }
    }

    // Graceful shutdown: SIGTERM → wait → SIGKILL (only if we own the process)
    const proc = this.chromeProcess;
    if (proc && proc.exitCode === null) {
      proc.kill("SIGTERM");

      const exited = await Promise.race([
        new Promise<true>((resolve) => proc.on("exit", () => resolve(true))),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 5000)),
      ]);

      if (!exited && proc.exitCode === null) {
        proc.kill("SIGKILL");
      }
    }

    // Cleanup temp directory
    if (this.ownsTempDir) {
      try {
        rmSync(this.userDataDir, { recursive: true, force: true });
      } catch {
        // Best effort cleanup
      }
    }
  }
}
