import CDP from "chrome-remote-interface";
import type { CDPConnection } from "./connection.js";
import { connect } from "./connection.js";
import { withTimeout } from "./timeout.js";
import { CDPConnectionError, TideSurfError } from "../errors.js";

export interface TabInfo {
  id: string;
  url: string;
  title: string;
  type: string;
}

/**
 * Manages multiple browser tabs via CDP.
 */
export class TabManager {
  private port: number;
  private host: string;

  constructor(port: number, host: string = "localhost") {
    this.port = port;
    this.host = host;
  }

  /**
   * List all open tabs (pages only, not service workers etc.)
   * NEW-CDP-003: Added timeout wrapper
   * MED-008: Wrapped errors in TideSurfError
   */
  async listTabs(timeout?: number): Promise<TabInfo[]> {
    try {
      const targets = await withTimeout(
        CDP.List({ port: this.port, host: this.host, useHostName: true }),
        timeout ?? 10_000,
        "listTabs"
      );
      return (targets as Array<{ id: string; url: string; title: string; type: string }>)
        .filter((t) => t.type === "page")
        .map((t) => ({
          id: t.id,
          url: t.url,
          title: t.title,
          type: t.type,
        }));
    } catch (err) {
      if (err instanceof TideSurfError) throw err;
      throw new CDPConnectionError(
        `Failed to list tabs: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err instanceof Error ? err : undefined }
      );
    }
  }

  /**
   * Create a new tab, optionally navigating to a URL.
   * NEW-CDP-003: Added timeout wrapper
   * MED-008: Wrapped errors in TideSurfError
   */
  async createTab(url?: string, timeout?: number): Promise<TabInfo> {
    try {
      const target = await withTimeout(
        CDP.New({
          port: this.port,
          host: this.host,
          url,
          useHostName: true,
        }) as Promise<{ id: string; url: string; title: string; type: string }>,
        timeout ?? 10_000,
        "createTab"
      );
      return {
        id: target.id,
        url: target.url,
        title: target.title,
        type: target.type,
      };
    } catch (err) {
      if (err instanceof TideSurfError) throw err;
      throw new CDPConnectionError(
        `Failed to create tab: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err instanceof Error ? err : undefined }
      );
    }
  }

  /**
   * Close a tab by its target ID.
   * NEW-CDP-003: Added timeout wrapper
   * MED-008: Wrapped errors in TideSurfError
   */
  async closeTab(tabId: string, timeout?: number): Promise<void> {
    try {
      await withTimeout(
        CDP.Close({
          port: this.port,
          host: this.host,
          id: tabId,
          useHostName: true,
        }),
        timeout ?? 10_000,
        "closeTab"
      );
    } catch (err) {
      if (err instanceof TideSurfError) throw err;
      throw new CDPConnectionError(
        `Failed to close tab ${tabId}: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err instanceof Error ? err : undefined }
      );
    }
  }

  /**
   * Connect to a specific tab and return a CDPConnection.
   */
  async connectToTab(tabId: string, timeout?: number): Promise<CDPConnection> {
    return connect({ port: this.port, host: this.host, tab: tabId, timeout });
  }

  /**
   * Check if the CDP connection is still alive.
   * MED-009: Disconnect detection
   */
  async isConnected(timeout?: number): Promise<boolean> {
    try {
      // Type assertion needed because chrome-remote-interface types don't expose Version method
      const cdpModule = CDP as unknown as { Version(options: { port: number; host: string }): Promise<unknown> };
      await withTimeout(
        cdpModule.Version({ port: this.port, host: this.host }),
        timeout ?? 5_000,
        "isConnected"
      );
      return true;
    } catch {
      return false;
    }
  }
}
