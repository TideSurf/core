import type { ChildProcess } from "node:child_process";
import type { TideSurfOptions, TideSurfConnectOptions, ToolResult, GetStateOptions, PageState } from "./types.js";
import {
  discoverBrowser,
  launchChrome,
  terminateChromeProcess,
} from "./cdp/launcher.js";
import { connect, disconnect, type CDPConnection } from "./cdp/connection.js";
import { SurfingPage } from "./cdp/page.js";
import { TabManager, type TabInfo } from "./cdp/tab-manager.js";
import { createToolExecutor, getToolDefinitions } from "./tools/registry.js";
import { rmSync } from "node:fs";
import { applyViewport } from "./cdp/viewport.js";
import {
  resolveFileAccessRoots,
  validatePositiveInteger,
  validateUrl,
  type UrlValidationOptions,
} from "./validation.js";
import {
  CDPConnectionError,
  ChromeLaunchError,
  ReadOnlyError,
} from "./errors.js";

interface DiscoveredEndpoint {
  port: number;
  host: string;
  targetId: string;
}

const DISCOVERED_ENDPOINT = Symbol("TideSurf.discoveredEndpoint");
const CONNECTION_INFO = new WeakMap<TideSurf, { host: string; port: number }>();

function validateRuntimeOptions(options: {
  timeout?: number;
  defaultViewport?: { width: number; height: number };
}): void {
  if (options.timeout !== undefined) {
    validatePositiveInteger(options.timeout, "timeout");
  }
  if (options.defaultViewport) {
    validatePositiveInteger(options.defaultViewport.width, "defaultViewport.width");
    validatePositiveInteger(options.defaultViewport.height, "defaultViewport.height");
  }
}

async function rollbackCDP(
  primaryError: unknown,
  message: string,
  operations: readonly (() => unknown | Promise<unknown>)[]
): Promise<never> {
  const cleanupErrors: unknown[] = [];
  for (const operation of operations) {
    try {
      await operation();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (cleanupErrors.length > 0) {
    throw new CDPConnectionError(message, {
      cause: new AggregateError(
        [primaryError, ...cleanupErrors],
        "CDP operation and rollback failed"
      ),
    });
  }
  throw primaryError;
}

async function initializePage(
  conn: CDPConnection,
  options: Pick<TideSurfOptions, "defaultViewport" | "readOnly" | "timeout">,
  fileAccessRoots: string[],
  urlValidationOptions: UrlValidationOptions
): Promise<SurfingPage> {
  if (options.defaultViewport) {
    await applyViewport(conn, options.defaultViewport, options.timeout);
  }
  return new SurfingPage(
    conn,
    fileAccessRoots,
    urlValidationOptions,
    options.readOnly ?? false,
    options.timeout
  );
}

export function getTideSurfConnectionInfo(
  instance: TideSurf
): { host: string; port: number } | undefined {
  const info = CONNECTION_INFO.get(instance);
  return info ? { ...info } : undefined;
}

export function connectToDiscoveredBrowser(
  options: TideSurfConnectOptions,
  endpoint: DiscoveredEndpoint
): Promise<TideSurf> {
  return TideSurf.connect({
    ...options,
    [DISCOVERED_ENDPOINT]: endpoint,
  } as TideSurfConnectOptions);
}

/** Owns a managed or attached browser session and its stateful page tools. */
export class TideSurf {
  private chromeProcess: ChildProcess | null;
  private activePage: SurfingPage;
  private readonly pages: Map<string, SurfingPage> = new Map();
  private readonly tabManager: TabManager;
  private readonly executor: (tool: {
    name: string;
    input: Record<string, unknown>;
  }) => Promise<ToolResult>;
  private readonly userDataDir: string;
  private readonly ownsTempDir: boolean;
  private readonly readOnly: boolean;
  private readonly defaultViewport?: TideSurfOptions["defaultViewport"];
  private readonly fileAccessRoots: string[];
  private readonly urlValidationOptions: UrlValidationOptions;
  private exitHandler: (() => void) | null = null;
  private activeTabId: string | null;
  private closePromise: Promise<void> | null = null;
  private readonly timeout?: number;

  private constructor(
    chromeProcess: ChildProcess | null,
    page: SurfingPage,
    tabManager: TabManager,
    userDataDir: string,
    ownsTempDir: boolean,
    readOnly: boolean,
    activeTabId: string | null,
    defaultViewport: TideSurfOptions["defaultViewport"] | undefined,
    fileAccessRoots: string[],
    urlValidationOptions: UrlValidationOptions,
    timeout: number | undefined,
    connectionHost: string,
    connectionPort: number
  ) {
    this.chromeProcess = chromeProcess;
    this.activePage = page;
    this.tabManager = tabManager;
    this.userDataDir = userDataDir;
    this.ownsTempDir = ownsTempDir;
    this.readOnly = readOnly;
    this.activeTabId = activeTabId;
    this.defaultViewport = defaultViewport ? { ...defaultViewport } : undefined;
    this.fileAccessRoots = [...fileAccessRoots];
    this.urlValidationOptions = { ...urlValidationOptions };
    this.timeout = timeout;
    CONNECTION_INFO.set(this, { host: connectionHost, port: connectionPort });
    this.executor = createToolExecutor(this);

    if (activeTabId) {
      this.pages.set(activeTabId, page);
    }

    if (chromeProcess) {
      const ownedProcess = chromeProcess;
      this.exitHandler = () => void ownedProcess.kill();
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
    validateRuntimeOptions(options);
    const fileAccessRoots = resolveFileAccessRoots(options.fileAccessRoots);
    const urlValidationOptions: UrlValidationOptions = {
      allowLocalhost: options.allowLocalhost,
      allowPrivateHosts: options.allowPrivateHosts,
    };
    const {
      process: proc,
      port,
      host,
      targetId,
      userDataDir,
      ownsTempDir,
    } = await launchChrome({
      headless: options.headless ?? true,
      chromePath: options.chromePath,
      channel: options.channel,
      port: options.port,
      userDataDir: options.userDataDir,
      timeout: options.timeout,
    });

    let conn: CDPConnection | null = null;
    try {
      conn = await connect({ port, host, tab: targetId, timeout: options.timeout });
      const page = await initializePage(
        conn,
        options,
        fileAccessRoots,
        urlValidationOptions
      );
      const tabManager = new TabManager(port, host);

      return new TideSurf(
        proc,
        page,
        tabManager,
        userDataDir,
        ownsTempDir,
        options.readOnly ?? false,
        targetId,
        options.defaultViewport,
        fileAccessRoots,
        urlValidationOptions,
        options.timeout,
        host,
        port
      );
    } catch (err) {
      const cleanupErrors: unknown[] = [];
      if (conn) {
        try {
          await disconnect(conn);
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      const exited = await terminateChromeProcess(proc);
      if (!exited) {
        cleanupErrors.push(
          new ChromeLaunchError("Owned Chrome did not stop during setup rollback")
        );
      }
      if (ownsTempDir && exited) {
        try {
          rmSync(userDataDir, { recursive: true, force: true });
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      if (cleanupErrors.length > 0) {
        throw new ChromeLaunchError(
          "Browser setup failed and rollback did not complete",
          {
            cause: new AggregateError(
              [err, ...cleanupErrors],
              "Browser setup and rollback failed"
            ),
          }
        );
      }
      throw err;
    }
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
    validateRuntimeOptions(options);
    const supplied = (options as TideSurfConnectOptions & {
      [DISCOVERED_ENDPOINT]?: DiscoveredEndpoint;
    })[DISCOVERED_ENDPOINT];
    const endpoint = supplied ?? await discoverBrowser({
      port: options.port,
      host: options.host,
      timeout: options.timeout,
    });
    const fileAccessRoots = resolveFileAccessRoots(options.fileAccessRoots);
    const urlValidationOptions: UrlValidationOptions = {
      allowLocalhost: options.allowLocalhost,
      allowPrivateHosts: options.allowPrivateHosts,
    };
    const { port, host, targetId } = endpoint;

    const conn = await connect({ port, host, tab: targetId, timeout: options.timeout });
    try {
      const page = await initializePage(
        conn,
        options,
        fileAccessRoots,
        urlValidationOptions
      );
      const tabManager = new TabManager(port, host);

      return new TideSurf(
        null,
        page,
        tabManager,
        "",
        false,
        options.readOnly ?? false,
        targetId,
        options.defaultViewport,
        fileAccessRoots,
        urlValidationOptions,
        options.timeout,
        host,
        port
      );
    } catch (error) {
      return rollbackCDP(
        error,
        "Browser setup failed and CDP rollback did not complete",
        [() => disconnect(conn)]
      );
    }
  }

  /**
   * Navigate the active page to a URL.
   * @param url - Target URL
   * @throws {ReadOnlyError} if this instance is in read-only mode
   */
  async navigate(url: string): Promise<void> {
    this.assertOpen();
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
    this.assertOpen();
    return this.activePage.getState(options);
  }

  /**
   * Get the active SurfingPage instance.
   */
  getPage(): SurfingPage {
    this.assertOpen();
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

  /**
   * URL navigation policy used by tools layered on top of the SDK.
   */
  getUrlValidationOptions(): UrlValidationOptions {
    return { ...this.urlValidationOptions };
  }

  /**
   * List all open tabs.
   */
  async listTabs(): Promise<TabInfo[]> {
    this.assertOpen();
    const tabs = await this.tabManager.listTabs(this.timeout);
    this.assertOpen();
    return tabs;
  }

  /**
   * Open a new tab, optionally navigating to a URL.
   * @param url - Optional URL to navigate to
   * @returns Info about the new tab
   */
  async newTab(url?: string): Promise<TabInfo> {
    this.assertOpen();
    if (this.readOnly) throw new ReadOnlyError("newTab");
    if (url !== undefined) {
      validateUrl(url, this.urlValidationOptions);
    }
    const { tab, page } = await this.createConnectedTab(url);
    this.pages.set(tab.id, page);
    this.activePage = page;
    this.activeTabId = tab.id;
    return tab;
  }

  private async createConnectedTab(
    url?: string
  ): Promise<{ tab: TabInfo; page: SurfingPage }> {
    const tab = await this.tabManager.createTab(url, this.timeout);
    let conn: CDPConnection | undefined;
    try {
      conn = await this.tabManager.connectToTab(tab.id, this.timeout);
      if (this.defaultViewport) {
        await applyViewport(conn, this.defaultViewport, this.timeout);
      }
      const page = new SurfingPage(
        conn,
        this.fileAccessRoots,
        this.urlValidationOptions,
        this.readOnly,
        this.timeout
      );
      this.assertOpen();
      return { tab, page };
    } catch (error) {
      const cleanup: Array<() => Promise<unknown>> = [
        () => this.tabManager.closeTab(tab.id, this.timeout),
      ];
      if (conn) {
        const connected = conn;
        cleanup.unshift(() => disconnect(connected));
      }
      return rollbackCDP(
        error,
        `Tab ${tab.id} setup failed and rollback did not complete`,
        cleanup
      );
    }
  }

  /**
   * Switch the active tab.
   * @param tabId - Target tab ID
   */
  async switchTab(tabId: string): Promise<void> {
    this.assertOpen();
    let page = this.pages.get(tabId);
    if (!page) {
      let conn: CDPConnection | undefined;
      try {
        conn = await this.tabManager.connectToTab(tabId, this.timeout);
        if (this.defaultViewport) {
          await applyViewport(conn, this.defaultViewport, this.timeout);
        }
        page = new SurfingPage(
          conn,
          this.fileAccessRoots,
          this.urlValidationOptions,
          this.readOnly,
          this.timeout
        );
        this.assertOpen();
        this.pages.set(tabId, page);
      } catch (err) {
        const cleanup: Array<() => Promise<unknown>> = [];
        if (conn) {
          const connected = conn;
          cleanup.push(() => disconnect(connected));
        }
        return rollbackCDP(
          err,
          `Tab ${tabId} setup failed and CDP rollback did not complete`,
          cleanup
        );
      }
    }
    this.activePage = page;
    this.activeTabId = tabId;
  }

  /**
   * Close a tab by ID.
   * If closing the active tab, switches to the first remaining tab.
   * @param tabId - Tab to close
   */
  async closeTab(tabId: string): Promise<void> {
    this.assertOpen();
    if (this.readOnly) throw new ReadOnlyError("closeTab");
    const page = this.pages.get(tabId);
    const isActiveTab = tabId === this.activeTabId;

    let replacement: { tab: TabInfo; page: SurfingPage } | undefined;
    if (isActiveTab) {
      const tabs = await this.tabManager.listTabs(this.timeout);
      this.assertOpen();
      if (!tabs.some((tab) => tab.id !== tabId)) {
        replacement = await this.createConnectedTab("about:blank");
      }
    }

    try {
      await this.tabManager.closeTab(tabId, this.timeout);
      this.assertOpen();
    } catch (error) {
      return rollbackCDP(
        error,
        "Tab close failed and replacement rollback did not complete",
        replacement
          ? [
            () => replacement.page.close(),
            () => this.tabManager.closeTab(replacement.tab.id, this.timeout),
          ]
          : []
      );
    }

    this.pages.delete(tabId);
    let pageDisconnectFailed = false;
    let pageDisconnectError: unknown;
    if (page) {
      try {
        await page.close();
      } catch (error) {
        pageDisconnectFailed = true;
        pageDisconnectError = error;
      }
    }

    if (isActiveTab) {
      if (replacement) {
        this.pages.set(replacement.tab.id, replacement.page);
        this.activePage = replacement.page;
        this.activeTabId = replacement.tab.id;
      } else {
        const remainingTabs = await this.tabManager.listTabs(this.timeout);
        this.assertOpen();
        const nextTab =
          remainingTabs.find((tab) => this.pages.has(tab.id)) ?? remainingTabs[0];
        if (!nextTab) {
          throw new CDPConnectionError(
            "No browser tab remains after closing the active tab"
          );
        }
        await this.switchTab(nextTab.id);
      }
    }

    if (pageDisconnectFailed) {
      throw new CDPConnectionError(
        `Tab ${tabId} closed, but its CDP connection did not close cleanly`,
        {
          cause:
            pageDisconnectError instanceof Error
              ? pageDisconnectError
              : undefined,
        }
      );
    }
  }

  /** Disconnect pages, stop owned Chrome, and remove its temporary profile. */
  async close(): Promise<void> {
    this.closePromise ??= this.closeResources();
    return this.closePromise;
  }

  private async closeResources(): Promise<void> {
    if (this.exitHandler) {
      process.removeListener("exit", this.exitHandler);
      this.exitHandler = null;
    }

    const pages = new Set(this.pages.values());
    pages.add(this.activePage);
    this.pages.clear();
    this.activeTabId = null;
    const pageResults = await Promise.allSettled(
      [...pages].map((page) => page.close())
    );
    const disconnectFailure = pageResults.find(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );

    const proc = this.chromeProcess;
    this.chromeProcess = null;
    const exited = proc ? await terminateChromeProcess(proc) : true;

    let profileCleanup: { error: unknown } | undefined;
    if (this.ownsTempDir && exited) {
      try {
        rmSync(this.userDataDir, { recursive: true, force: true });
      } catch (error) {
        profileCleanup = { error };
      }
    }

    if (proc && !exited) {
      throw new ChromeLaunchError(
        "Failed to stop the TideSurf-owned Chrome process after SIGTERM and SIGKILL"
      );
    }

    if (disconnectFailure) {
      throw new CDPConnectionError("Failed to disconnect a TideSurf page", {
        cause:
          disconnectFailure.reason instanceof Error
            ? disconnectFailure.reason
            : undefined,
      });
    }

    if (profileCleanup) {
      throw new ChromeLaunchError(
        `Failed to remove temporary Chrome profile ${this.userDataDir}`,
        { cause: profileCleanup.error }
      );
    }
  }

  private assertOpen(): void {
    if (this.closePromise) {
      throw new CDPConnectionError("TideSurf is closed");
    }
  }
}
