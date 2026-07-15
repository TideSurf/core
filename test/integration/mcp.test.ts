import { describe, expect, it } from "bun:test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { TOOL_REGISTRY } from "../../src/tools/registry.js";
import { canResolveBrowser } from "../support/browser.js";

const root = join(import.meta.dir, "..", "..");
const cliPath = join(root, "src", "cli.ts");

const describeMcp = canResolveBrowser() ? describe : describe.skip;

describeMcp("MCP stdio parity", () => {
  it("lists canonical tools, calls them, and closes owned Chromium on EOF", async () => {
    const child = spawn(process.execPath, [cliPath, "mcp", "--quiet"], {
      cwd: root,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const lines = createInterface({ input: child.stdout });
    const iterator = lines[Symbol.asyncIterator]();

    const send = (value: unknown) => {
      child.stdin.write(`${JSON.stringify(value)}\n`);
    };
    const response = async (id: number): Promise<Record<string, unknown>> => {
      while (true) {
        const next = await iterator.next();
        if (next.done) throw new Error("MCP stdout closed before its response");
        const value = JSON.parse(next.value) as Record<string, unknown>;
        if (value["id"] === id) return value;
      }
    };

    try {
      send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "tidesurf-test", version: "1" },
        },
      });
      expect((await response(1))["result"]).toBeTruthy();
      send({ jsonrpc: "2.0", method: "notifications/initialized" });

      send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
      const listed = await response(2) as {
        result: { tools: Array<{ name: string }> };
      };
      expect(listed.result.tools.map((tool) => tool.name)).toEqual([
        "launch_browser",
        ...TOOL_REGISTRY.map((tool) => tool.name),
      ]);

      send({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "launch_browser", arguments: {} },
      });
      const launched = await response(3) as {
        result: { isError?: boolean };
      };
      expect(launched.result.isError).not.toBe(true);

      send({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "get_state", arguments: {} },
      });
      const state = await response(4) as {
        result: { content: Array<{ type: string; text?: string }> };
      };
      expect(state.result.content[0].text).toContain("# ");
      expect(state.result.content[0].text).toContain("> ");

      child.stdin.end();
      const closed = once(child, "close") as Promise<[number | null]>;
      const timeout = new Promise<never>((_, reject) => {
        const timer = setTimeout(() => reject(new Error("MCP did not exit after EOF")), 10_000);
        timer.unref?.();
      });
      const [code] = await Promise.race([closed, timeout]);
      expect(code).toBe(0);
    } finally {
      lines.close();
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  }, 60_000);
});
