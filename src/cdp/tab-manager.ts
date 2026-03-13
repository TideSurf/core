import CDP from "chrome-remote-interface";
import type { CDPConnection } from "./connection.js";
import { connect } from "./connection.js";

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
   */
  async listTabs(): Promise<TabInfo[]> {
    const targets = await CDP.List({ port: this.port, host: this.host });
    return (targets as Array<{ id: string; url: string; title: string; type: string }>)
      .filter((t) => t.type === "page")
      .map((t) => ({
        id: t.id,
        url: t.url,
        title: t.title,
        type: t.type,
      }));
  }

  /**
   * Create a new tab, optionally navigating to a URL.
   */
  async createTab(url?: string): Promise<TabInfo> {
    const target = await CDP.New({
      port: this.port,
      host: this.host,
      url,
    }) as { id: string; url: string; title: string; type: string };
    return {
      id: target.id,
      url: target.url,
      title: target.title,
      type: target.type,
    };
  }

  /**
   * Close a tab by its target ID.
   */
  async closeTab(tabId: string): Promise<void> {
    await CDP.Close({
      port: this.port,
      host: this.host,
      id: tabId,
    });
  }

  /**
   * Connect to a specific tab and return a CDPConnection.
   */
  async connectToTab(tabId: string): Promise<CDPConnection> {
    return connect({ port: this.port, host: this.host, tab: tabId });
  }
}
