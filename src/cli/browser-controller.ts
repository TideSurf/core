import {
  TideSurf,
  connectToDiscoveredBrowser,
  getTideSurfConnectionInfo,
} from "../tidesurf.js";
import { CDPConnectionError } from "../errors.js";
import { discoverActiveBrowser } from "../cdp/launcher.js";
import {
  dispatchTool,
  executeValidatedToolSpec,
  type ToolExecutionContext,
  type ToolDispatchOptions,
  type ToolSpec,
} from "../tools/registry.js";
import type { ReadPageOptions, ToolResult } from "../types.js";
import type { SessionConfig } from "./session.js";

interface BrowserStatus {
  running: boolean;
  source?: "launched" | "attached";
  headless: boolean;
  readOnly: boolean;
  host?: string;
  port?: number;
}

function isLocalHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function endpointFromUrl(value: string): { host: string; port: number } {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CDPConnectionError(`Invalid browser URL: ${value}`);
  }
  if (url.protocol !== "http:") {
    throw new CDPConnectionError("Browser URL must use http://");
  }
  const port = url.port ? Number(url.port) : 80;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new CDPConnectionError(`Invalid browser URL port: ${url.port}`);
  }
  return { host: url.hostname.replace(/^\[|\]$/g, ""), port };
}

export class BrowserController {
  private readonly config: SessionConfig;
  private browser: TideSurf | null = null;
  private source: "launched" | "attached" | undefined;
  private opening: Promise<TideSurf> | null = null;
  private operationTail: Promise<void> = Promise.resolve();
  private closing: Promise<void> | null = null;
  private closed = false;
  private readonly dispatchOptions: ToolDispatchOptions;
  private readonly executeValidated = (
    tool: ToolSpec,
    input: Record<string, unknown>
  ): Promise<ToolResult> => this.executeTool(tool, input);

  constructor(config: SessionConfig) {
    this.config = {
      ...config,
      fileAccessRoots: config.fileAccessRoots ? [...config.fileAccessRoots] : undefined,
    };
    this.dispatchOptions = {
      readOnly: this.config.readOnly,
      urlOptions: {
        allowLocalhost: this.config.allowLocalhost,
        allowPrivateHosts: this.config.allowPrivateHosts,
      },
    };
  }

  status(): BrowserStatus {
    const endpoint = this.browser
      ? getTideSurfConnectionInfo(this.browser)
      : undefined;
    return {
      running: this.browser !== null,
      source: this.source,
      headless: this.config.headless,
      readOnly: this.config.readOnly,
      host: endpoint?.host,
      port: endpoint?.port,
    };
  }

  async start(): Promise<BrowserStatus> {
    return this.runSerialized(async () => {
      await this.getBrowser();
      return this.status();
    });
  }

  async launchBrowser(options: { headless?: boolean } = {}): Promise<{
    alreadyRunning: boolean;
    headless: boolean;
    source: "launched" | "attached";
  }> {
    return this.runSerialized(async () => {
      const alreadyRunning = this.browser !== null;
      if (!alreadyRunning && options.headless !== undefined) {
        this.config.headless = options.headless;
      }
      await this.getBrowser();
      return {
        alreadyRunning,
        headless: this.config.headless,
        source: this.source!,
      };
    });
  }

  async getBrowser(): Promise<TideSurf> {
    if (this.closed) {
      throw new CDPConnectionError("Browser controller is closed");
    }
    if (this.browser) return this.browser;
    if (!this.opening) {
      this.opening = this.acquire().then((browser) => {
        this.browser = browser;
        return browser;
      }).finally(() => {
        this.opening = null;
      });
    }
    return this.opening;
  }

  private commonOptions(timeout: number | undefined) {
    return {
      readOnly: this.config.readOnly,
      timeout,
      fileAccessRoots: this.config.fileAccessRoots,
      allowLocalhost: this.config.allowLocalhost,
      allowPrivateHosts: this.config.allowPrivateHosts,
    };
  }

  private async attach(
    host: string,
    port: number,
    targetId: string | undefined,
    timeout: number | undefined
  ): Promise<TideSurf> {
    const options = { ...this.commonOptions(timeout), host, port };
    const browser = targetId
      ? await connectToDiscoveredBrowser(options, { host, port, targetId })
      : await TideSurf.connect(options);
    this.source = "attached";
    return browser;
  }

  private async launch(port?: number, timeout = this.config.timeout): Promise<TideSurf> {
    const browser = await TideSurf.launch({
      ...this.commonOptions(timeout),
      headless: this.config.headless,
      chromePath: this.config.chromePath,
      channel: this.config.channel,
      userDataDir: this.config.userDataDir,
      port,
    });
    this.source = "launched";
    return browser;
  }

  private async acquire(): Promise<TideSurf> {
    if (this.config.browserMode === "launch") {
      return this.launch(this.config.port);
    }
    const deadline = Date.now() + (this.config.timeout ?? 15_000);
    const remaining = (cap?: number) => {
      const value = deadline - Date.now();
      if (value <= 0) throw new CDPConnectionError("Browser acquisition timed out");
      return cap === undefined ? value : Math.min(value, cap);
    };

    const explicitEndpoint = this.config.browserUrl
      ? endpointFromUrl(this.config.browserUrl)
      : this.config.port !== undefined || this.config.host !== undefined
        ? { host: this.config.host ?? "127.0.0.1", port: this.config.port ?? 9222 }
        : undefined;

    let connectionError: unknown;
    if (explicitEndpoint) {
      try {
        return await this.attach(
          explicitEndpoint.host,
          explicitEndpoint.port,
          undefined,
          this.config.browserMode === "auto" ? remaining(3_000) : this.config.timeout
        );
      } catch (error) {
        if (!(error instanceof CDPConnectionError)) throw error;
        connectionError = error;
      }

      if (!isLocalHost(explicitEndpoint.host)) {
        throw connectionError;
      }
    }

    try {
      const active = await discoverActiveBrowser({
        channel: this.config.channel,
        userDataDir: this.config.userDataDir,
        timeout: remaining(5_000),
      });
      return await this.attach(
        active.host,
        active.port,
        active.targetId,
        remaining(3_000)
      );
    } catch (error) {
      if (!(error instanceof CDPConnectionError)) throw error;
      connectionError = error;
    }

    if (
      !explicitEndpoint ||
      explicitEndpoint.port !== 9222
    ) {
      try {
        return await this.attach("127.0.0.1", 9222, undefined, remaining(1_500));
      } catch (error) {
        if (!(error instanceof CDPConnectionError)) throw error;
        connectionError = error;
      }
    }

    if (this.config.browserMode === "connect") {
      throw connectionError;
    }

    return this.launch(this.config.port, remaining());
  }

  async execute(name: string, input: Record<string, unknown>): Promise<ToolResult> {
    return dispatchTool(
      { name, input },
      this.dispatchOptions,
      this.executeValidated
    );
  }

  async inspect(url: string, options: ReadPageOptions): Promise<ToolResult> {
    const context: ToolExecutionContext = {
      pageRead: { options, contentOnly: true },
    };
    return dispatchTool(
      { name: "navigate", input: { url } },
      this.dispatchOptions,
      (tool, input) => this.executeTool(tool, input, context)
    );
  }

  private executeTool(
    tool: ToolSpec,
    input: Record<string, unknown>,
    context?: ToolExecutionContext
  ): Promise<ToolResult> {
    return this.runSerialized(async () =>
      executeValidatedToolSpec(await this.getBrowser(), tool, input, context)
    );
  }

  private runSerialized<T>(operation: () => Promise<T>): Promise<T> {
    const run = () => {
      if (this.closed) {
        throw new CDPConnectionError("Browser controller is closed");
      }
      return operation();
    };
    const result = this.operationTail.then(run);
    this.operationTail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  async close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.closing = (async () => {
      await this.operationTail;
      await this.opening?.catch(() => undefined);
      const browser = this.browser;
      this.browser = null;
      this.source = undefined;
      if (browser) await browser.close();
    })();
    return this.closing;
  }
}
