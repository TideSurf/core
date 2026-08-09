import type { ChildProcess } from "node:child_process";
import {
  CHROME_CHANNELS,
  type TideSurfOptions,
  type TideSurfConnectOptions,
  type ToolResult,
  type ReadPageOptions,
  type GetStateOptions,
  type PageState,
} from "./types.js";
import {
  discoverBrowser,
  launchChrome,
  noteOwnedBrowserDisconnected,
  releaseOwnedBrowserEndpoint,
  scheduleOwnedBrowserCleanup,
  terminateChromeProcess,
  unregisterOrphanedBrowser,
} from "./cdp/launcher.js";
import { connect, disconnect, type CDPConnection } from "./cdp/connection.js";
import { SurfingPage, isSurfingPageConnected } from "./cdp/page.js";
import { TabManager, type TabInfo } from "./cdp/tab-manager.js";
import { createToolExecutor, getToolDefinitions } from "./tools/registry.js";
import { rm } from "node:fs/promises";
import { applyViewport } from "./cdp/viewport.js";
import {
  resolveFileAccessRoots,
  validateScreenshotDimensions,
  validatePort,
  validatePositiveInteger,
  validateTimeout,
  validateUrl,
  type UrlValidationOptions,
} from "./validation.js";
import {
  ActionCommittedError,
  CDPConnectionError,
  ChromeLaunchError,
  ReadOnlyError,
  ValidationError,
} from "./errors.js";

interface DiscoveredEndpoint {
  port: number;
  host: string;
  targetId: string;
}

const DISCOVERED_ENDPOINT = Symbol("TideSurf.discoveredEndpoint");
const CONNECTION_INFO = new WeakMap<TideSurf, { host: string; port: number }>();
const DEFAULT_CLOSE_TIMEOUT_MS = 4_000;

function remainingCloseTime(deadline: number): number {
  return Math.max(1, deadline - Date.now());
}

async function settleCloseByDeadline<T>(
  promise: Promise<T>,
  deadline: number,
  label: string
): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    throw new ChromeLaunchError(`${label} exceeded the browser close deadline`);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new ChromeLaunchError(
            `${label} exceeded the browser close deadline`
          )),
          remaining
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function validateRuntimeOptionsObject(value: unknown): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("TideSurf options must be an object");
  }
}

function validateRuntimeOptions(
  options: TideSurfOptions | TideSurfConnectOptions
): void {
  const values = options as Record<string, unknown>;
  if (options.timeout !== undefined) {
    validateTimeout(options.timeout);
  }
  if (options.port !== undefined) validatePort(options.port);
  if (options.defaultViewport !== undefined) {
    if (
      options.defaultViewport === null ||
      typeof options.defaultViewport !== "object" ||
      Array.isArray(options.defaultViewport)
    ) {
      throw new ValidationError("defaultViewport must be an object");
    }
    validatePositiveInteger(options.defaultViewport.width, "defaultViewport.width");
    validatePositiveInteger(options.defaultViewport.height, "defaultViewport.height");
    validateScreenshotDimensions(
      options.defaultViewport.width,
      options.defaultViewport.height
    );
  }
  for (const [name, value] of [
    ["chromePath", values["chromePath"]],
    ["userDataDir", values["userDataDir"]],
    ["host", values["host"]],
  ] as const) {
    if (value !== undefined && (typeof value !== "string" || value.trim() === "")) {
      throw new ValidationError(`${name} must be a non-empty string`);
    }
  }
  for (const name of [
    "headless",
    "readOnly",
    "allowLocalhost",
    "allowPrivateHosts",
  ] as const) {
    const value = values[name];
    if (value !== undefined && typeof value !== "boolean") {
      throw new ValidationError(`${name} must be a boolean`);
    }
  }
  if (options.fileAccessRoots !== undefined) {
    if (!Array.isArray(options.fileAccessRoots)) {
      throw new ValidationError("fileAccessRoots must be an array");
    }
  }
  const channel = values["channel"];
  if (channel !== undefined && (
    typeof channel !== "string" ||
    !CHROME_CHANNELS.includes(channel as (typeof CHROME_CHANNELS)[number])
  )) {
    throw new ValidationError("channel must be stable, beta, dev, canary, or chromium");
  }
}

function snapshotOptions<
  T extends TideSurfOptions | TideSurfConnectOptions
>(options: T): T {
  return {
    ...options,
    defaultViewport: options.defaultViewport
      ? { ...options.defaultViewport }
      : undefined,
    fileAccessRoots: options.fileAccessRoots
      ? [...options.fileAccessRoots]
      : options.fileAccessRoots,
  } as T;
}

function validateTabId(tabId: string): void {
  if (typeof tabId !== "string" || tabId.trim() === "") {
    throw new ValidationError("tabId must be a non-empty string");
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
  private closeRequested = false;
  private closeComplete = false;
  private readonly timeout?: number;
  private readonly ownershipToken?: string;
  private readonly orphanToken?: string;
  private readonly ownedChromePid: number | null;
  private profileCleanupComplete: boolean;
  private orphanCleanupComplete: boolean;
  private pagesCapturedForClose = false;
  private readonly pagesToClose = new Set<SurfingPage>();
  private readonly pendingPageWork = new Set<Promise<unknown>>();
  private readonly pendingTabConnections = new Map<string, Promise<SurfingPage>>();
  private tabMutationTail: Promise<void> = Promise.resolve();

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
    connectionPort: number,
    ownershipToken?: string,
    orphanToken?: string
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
    this.ownershipToken = ownershipToken;
    this.orphanToken = orphanToken;
    this.ownedChromePid = typeof chromeProcess?.pid === "number"
      ? chromeProcess.pid
      : null;
    this.profileCleanupComplete = !ownsTempDir;
    this.orphanCleanupComplete = this.ownedChromePid === null;
    CONNECTION_INFO.set(this, { host: connectionHost, port: connectionPort });
    this.executor = createToolExecutor(this);

    if (activeTabId) {
      this.pages.set(activeTabId, page);
    }

    if (chromeProcess) {
      const ownedProcess = chromeProcess;
      this.exitHandler = () => {
        try {
          ownedProcess.kill();
        } catch {
          // best-effort kill at exit
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
    validateRuntimeOptionsObject(options);
    validateRuntimeOptions(options);
    const config = snapshotOptions(options);
    const fileAccessRoots = resolveFileAccessRoots(config.fileAccessRoots);
    const urlValidationOptions: UrlValidationOptions = {
      allowLocalhost: config.allowLocalhost,
      allowPrivateHosts: config.allowPrivateHosts,
    };
    const {
      process: proc,
      port,
      host,
      targetId,
      userDataDir,
      ownsTempDir,
      ownershipToken,
      orphanToken,
    } = await launchChrome({
      headless: config.headless ?? true,
      chromePath: config.chromePath,
      channel: config.channel,
      port: config.port,
      userDataDir: config.userDataDir,
      timeout: config.timeout,
    });

    let conn: CDPConnection | null = null;
    try {
      conn = await connect({ port, host, tab: targetId, timeout: config.timeout });
      const page = await initializePage(
        conn,
        config,
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
        config.readOnly ?? false,
        targetId,
        config.defaultViewport,
        fileAccessRoots,
        urlValidationOptions,
        config.timeout,
        host,
        port,
        ownershipToken,
        orphanToken
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
      // Drop endpoint ownership only after process death. A failed rollback
      // keeps its token-bound claim but invalidates the cached verification.
      if (exited) {
        releaseOwnedBrowserEndpoint(host, port, ownershipToken);
      } else {
        noteOwnedBrowserDisconnected(host, port, ownershipToken);
      }

      let profileRemoved = !ownsTempDir;
      if (ownsTempDir && exited) {
        try {
          await rm(userDataDir, { recursive: true, force: true });
          profileRemoved = true;
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      let orphanRemoved = false;
      if (exited && profileRemoved && typeof proc.pid === "number") {
        orphanRemoved = unregisterOrphanedBrowser(
          process.pid,
          proc.pid,
          orphanToken
        );
      }
      if (!exited || !profileRemoved || !orphanRemoved) {
        scheduleOwnedBrowserCleanup({
          process: proc,
          userDataDir,
          ownsTempDir,
          orphanToken,
          host,
          port,
          ownershipToken,
        });
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
    validateRuntimeOptionsObject(options);
    validateRuntimeOptions(options);
    const config = snapshotOptions(options);
    const fileAccessRoots = resolveFileAccessRoots(config.fileAccessRoots);
    const supplied = (config as TideSurfConnectOptions & {
      [DISCOVERED_ENDPOINT]?: DiscoveredEndpoint;
    })[DISCOVERED_ENDPOINT];
    const endpoint = supplied ?? await discoverBrowser({
      port: config.port,
      host: config.host,
      timeout: config.timeout,
    });
    const urlValidationOptions: UrlValidationOptions = {
      allowLocalhost: config.allowLocalhost,
      allowPrivateHosts: config.allowPrivateHosts,
    };
    const { port, host, targetId } = endpoint;

    const conn = await connect({ port, host, tab: targetId, timeout: config.timeout });
    try {
      const page = await initializePage(
        conn,
        config,
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
        config.readOnly ?? false,
        targetId,
        config.defaultViewport,
        fileAccessRoots,
        urlValidationOptions,
        config.timeout,
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

  async navigate(url: string): Promise<void> {
    this.assertOpen();
    if (this.readOnly) {
      throw new ReadOnlyError("navigate");
    }
    await this.activePage.navigate(url);
  }

  async readPage(options?: ReadPageOptions): Promise<PageState> {
    this.assertOpen();
    return this.activePage.readPage(options);
  }

  /** @deprecated Use `readPage()`. */
  getState(options?: GetStateOptions): Promise<PageState> {
    return this.readPage(options);
  }

  getPage(): SurfingPage {
    this.assertOpen();
    return this.activePage;
  }

  getToolExecutor() {
    return this.executor;
  }

  getToolDefinitions() {
    return getToolDefinitions({ readOnly: this.readOnly });
  }

  isReadOnly(): boolean {
    return this.readOnly;
  }

  getUrlValidationOptions(): UrlValidationOptions {
    return { ...this.urlValidationOptions };
  }

  async listTabs(): Promise<TabInfo[]> {
    this.assertOpen();
    const tabs = await this.tabManager.listTabs(this.timeout);
    this.assertOpen();
    return tabs;
  }

  async newTab(url?: string): Promise<TabInfo> {
    this.assertOpen();
    if (this.readOnly) throw new ReadOnlyError("newTab");
    if (url !== undefined) {
      validateUrl(url, this.urlValidationOptions);
    }
    return this.queueTabMutation(async () => {
      this.assertOpen();
      return this.openTab(url);
    });
  }

  private async openTab(url?: string): Promise<TabInfo> {
    const { tab, page } = await this.createConnectedTabResources(url);
    try {
      this.assertOpen();
      this.pages.set(tab.id, page);
      this.activePage = page;
      this.activeTabId = tab.id;
      return tab;
    } catch (error) {
      return rollbackCDP(
        error,
        `Tab ${tab.id} opened while TideSurf was closing and rollback did not complete`,
        [
          () => page.close(),
          () => this.tabManager.closeTab(tab.id, this.timeout),
        ]
      );
    }
  }

  private async createConnectedTabResources(
    url?: string
  ): Promise<{ tab: TabInfo; page: SurfingPage }> {
    const tab = await this.tabManager.createTab(url, this.timeout);
    try {
      return { tab, page: await this.connectPage(tab.id) };
    } catch (error) {
      return rollbackCDP(
        error,
        `Tab ${tab.id} setup failed and rollback did not complete`,
        [() => this.tabManager.closeTab(tab.id, this.timeout)]
      );
    }
  }

  private async connectPage(tabId: string): Promise<SurfingPage> {
    this.assertOpen();
    let conn: CDPConnection | undefined;
    try {
      conn = await this.tabManager.connectToTab(tabId, this.timeout);
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
      return page;
    } catch (error) {
      const cleanup: Array<() => Promise<unknown>> = [];
      if (conn) {
        const connected = conn;
        cleanup.push(() => disconnect(connected));
      }
      return rollbackCDP(
        error,
        `Tab ${tabId} setup failed and CDP rollback did not complete`,
        cleanup
      );
    }
  }

  private trackPageWork<T>(work: Promise<T>): Promise<T> {
    this.pendingPageWork.add(work);
    const remove = () => {
      this.pendingPageWork.delete(work);
    };
    void work.then(remove, remove);
    return work;
  }

  private queueTabMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tabMutationTail.then(operation);
    this.tabMutationTail = result.then(
      () => undefined,
      () => undefined
    );
    return this.trackPageWork(result);
  }

  private evictDisconnectedPage(tabId: string): void {
    const cached = this.pages.get(tabId);
    if (cached && !isSurfingPageConnected(cached)) {
      this.pages.delete(tabId);
    }
  }

  private connectTabOnce(tabId: string): Promise<SurfingPage> {
    const cached = this.pages.get(tabId);
    if (cached) return Promise.resolve(cached);
    const pending = this.pendingTabConnections.get(tabId);
    if (pending) return pending;

    const connection = this.trackPageWork(
      this.connectPage(tabId).then((page) => {
        this.pages.set(tabId, page);
        return page;
      })
    );
    this.pendingTabConnections.set(tabId, connection);
    const remove = () => {
      if (this.pendingTabConnections.get(tabId) === connection) {
        this.pendingTabConnections.delete(tabId);
      }
    };
    void connection.then(remove, remove);
    return connection;
  }

  async switchTab(tabId: string): Promise<void> {
    this.assertOpen();
    validateTabId(tabId);
    return this.queueTabMutation(async () => {
      this.assertOpen();
      this.evictDisconnectedPage(tabId);
      const page = await this.connectTabOnce(tabId);
      this.assertOpen();
      this.activePage = page;
      this.activeTabId = tabId;
    });
  }

  async closeTab(tabId: string): Promise<void> {
    this.assertOpen();
    if (this.readOnly) throw new ReadOnlyError("closeTab");
    validateTabId(tabId);
    return this.queueTabMutation(async () => {
      this.assertOpen();
      return this.closeTabResources(tabId);
    });
  }

  private async closeTabResources(tabId: string): Promise<void> {
    const page = this.pages.get(tabId);
    const isActiveTab = tabId === this.activeTabId;

    let successor:
      | { tab: TabInfo; page: SurfingPage; ownsTarget: boolean }
      | undefined;
    let successorCommitted = false;
    try {
      if (isActiveTab) {
        const tabs = await this.tabManager.listTabs(this.timeout);
        this.assertOpen();
        const nextTab = tabs.find((tab) => tab.id !== tabId);
        if (nextTab) {
          this.evictDisconnectedPage(nextTab.id);
          successor = {
            tab: nextTab,
            page: await this.connectTabOnce(nextTab.id),
            ownsTarget: false,
          };
        } else {
          successor = {
            ...(await this.createConnectedTabResources("about:blank")),
            ownsTarget: true,
          };
        }
      }

      this.assertOpen();
      try {
        await this.tabManager.closeTab(tabId, this.timeout);
      } catch (error) {
        if (error instanceof ActionCommittedError && successor) {
          if (successor.ownsTarget) {
            this.pages.set(successor.tab.id, successor.page);
          }
          this.activePage = successor.page;
          this.activeTabId = successor.tab.id;
          successorCommitted = true;
        }
        throw error;
      }
      this.assertOpen();

      this.pages.delete(tabId);
      let pageDisconnectError: unknown;
      if (page) {
        try {
          await page.close();
        } catch (error) {
          pageDisconnectError = error;
        }
      }

      if (isActiveTab) {
        this.assertOpen();
        if (!successor) {
          throw new CDPConnectionError(
            "No browser tab remains after closing the active tab"
          );
        }
        if (successor.ownsTarget) {
          this.pages.set(successor.tab.id, successor.page);
        }
        this.activePage = successor.page;
        this.activeTabId = successor.tab.id;
        successorCommitted = true;
      }

      if (pageDisconnectError) {
        throw new ActionCommittedError(
          `Tab ${tabId} close`,
          pageDisconnectError
        );
      }
    } catch (error) {
      if (!successor?.ownsTarget || successorCommitted) throw error;
      const uncommitted = successor;
      return rollbackCDP(
        error,
        "Tab close failed and successor rollback did not complete",
        [
          () => uncommitted.page.close(),
          () => this.tabManager.closeTab(uncommitted.tab.id, this.timeout),
        ]
      );
    }
  }

  /** Disconnect pages, stop owned Chrome, and remove its temporary profile. */
  async close(
    deadline = Date.now() + DEFAULT_CLOSE_TIMEOUT_MS
  ): Promise<void> {
    if (this.closeComplete) return;
    if (this.closePromise) return this.closePromise;
    this.closeRequested = true;
    const attempt = this.closeResources(deadline);
    this.closePromise = attempt;
    try {
      await attempt;
      this.closeComplete = true;
    } finally {
      // A rejected close retains every unfinished resource and can be retried.
      if (this.closePromise === attempt) this.closePromise = null;
    }
  }

  private capturePagesForClose(): void {
    if (this.pagesCapturedForClose) return;
    this.pagesCapturedForClose = true;
    for (const page of this.pages.values()) this.pagesToClose.add(page);
    this.pagesToClose.add(this.activePage);
    this.pages.clear();
    this.activeTabId = null;
  }

  private closePages(): Promise<PromiseSettledResult<void>[]> {
    const attempts = [...this.pagesToClose].map(async (page) => {
      await page.close();
      this.pagesToClose.delete(page);
    });
    return Promise.allSettled(attempts);
  }

  private async closeOwnedResources(deadline: number): Promise<void> {
    const proc = this.chromeProcess;
    if (proc) {
      const exited = await terminateChromeProcess(
        proc,
        remainingCloseTime(deadline)
      );
      if (!exited) {
        throw new ChromeLaunchError(
          "Failed to stop the TideSurf-owned Chrome process before the close deadline"
        );
      }
      if (this.chromeProcess === proc) this.chromeProcess = null;
      // Keep the process-exit fallback installed until death is confirmed.
      if (this.exitHandler) {
        process.removeListener("exit", this.exitHandler);
        this.exitHandler = null;
      }
      const info = CONNECTION_INFO.get(this);
      if (info && this.ownershipToken) {
        releaseOwnedBrowserEndpoint(info.host, info.port, this.ownershipToken);
      }
    }

    if (this.ownsTempDir && !this.profileCleanupComplete) {
      try {
        await settleCloseByDeadline(
          rm(this.userDataDir, { recursive: true, force: true }),
          deadline,
          "Temporary Chrome profile cleanup"
        );
        this.profileCleanupComplete = true;
      } catch (error) {
        throw new ChromeLaunchError(
          `Failed to remove temporary Chrome profile ${this.userDataDir}`,
          { cause: error instanceof Error ? error : undefined }
        );
      }
    }

    // The durable record is the retry mechanism for profile deletion and is
    // removed only after process death and successful profile cleanup.
    if (
      !this.orphanCleanupComplete &&
      this.ownedChromePid !== null &&
      this.profileCleanupComplete
    ) {
      if (!unregisterOrphanedBrowser(
        process.pid,
        this.ownedChromePid,
        this.orphanToken
      )) {
        throw new ChromeLaunchError("Failed to remove owned Chrome cleanup record");
      }
      this.orphanCleanupComplete = true;
    }
  }

  private async closeResources(deadline: number): Promise<void> {
    this.capturePagesForClose();

    // Start CDP teardown and process termination together. They are the
    // cancellation mechanisms for pending page work, not tasks to defer until
    // after an independent drain timeout.
    const pageResults = this.closePages();
    const ownedResources = this.closeOwnedResources(deadline);
    const pendingWork = Promise.allSettled([...this.pendingPageWork]);
    const [results] = await settleCloseByDeadline(
      Promise.all([pageResults, ownedResources, pendingWork]),
      deadline,
      "TideSurf close"
    );
    const disconnectFailure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );
    if (disconnectFailure) {
      throw new CDPConnectionError("Failed to disconnect a TideSurf page", {
        cause: disconnectFailure.reason instanceof Error
          ? disconnectFailure.reason
          : undefined,
      });
    }
  }

  private assertOpen(): void {
    if (this.closeRequested) {
      throw new CDPConnectionError("TideSurf is closed");
    }
  }
}
