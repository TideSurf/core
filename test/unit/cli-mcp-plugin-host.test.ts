import { afterEach, describe, expect, it } from "bun:test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { pluginDataDirectory } from "../../src/extensions/plugins.js";

const root = join(import.meta.dir, "..", "..");
const cliPath = join(root, "src", "cli.ts");
const PLUGIN_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const MCP_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";

let tempDirectories: string[] = [];

function makeTemp(): string {
  const directory = mkdtempSync(join(tmpdir(), "tidesurf-cli-mcp-plugin-"));
  tempDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of tempDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  tempDirectories = [];
});

function writePluginFixture(options: { hang?: boolean } = {}): {
  home: string;
  pluginsRoot: string;
  marker: string;
  dataDirectory: string;
} {
  const home = makeTemp();
  const pluginsRoot = join(makeTemp(), "plugins");
  const pluginRoot = join(pluginsRoot, "probe");
  const marker = join(makeTemp(), "spawned.txt");
  mkdirSync(pluginRoot, { recursive: true });
  writeFileSync(
    join(pluginRoot, "plugin.json"),
    JSON.stringify({ $schema: PLUGIN_SCHEMA, name: "probe" })
  );
  writeFileSync(
    join(pluginRoot, "mcp.json"),
    JSON.stringify({
      $schema: MCP_SCHEMA,
      mcpServers: {
        probe: {
          type: "stdio",
          command: "node",
          args: ["${PLUGIN_ROOT}/server.mjs"],
          env: { MARKER: marker },
          cwd: "${PLUGIN_ROOT}",
        },
      },
    })
  );
  const script = options.hang
    ? `
import { writeFileSync } from "node:fs";
writeFileSync(process.env.MARKER, String(process.pid));
process.stdin.resume();
`
    : `
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
writeFileSync(process.env.MARKER, process.env.TIDESURF_PLUGIN_MCP_CHILD ?? "missing");
const lines = createInterface({ input: process.stdin });
for await (const line of lines) {
  const request = JSON.parse(line);
  if (request.method === "initialize") {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        protocolVersion: request.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "probe", version: "1" }
      }
    }) + "\\n");
  } else if (request.method === "tools/list") {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        tools: [{
          name: "probe_tool",
          description: "Probe tool",
          inputSchema: { type: "object", properties: {} }
        }]
      }
    }) + "\\n");
  }
}
`;
  writeFileSync(join(pluginRoot, "server.mjs"), script);
  return {
    home,
    pluginsRoot,
    marker,
    dataDirectory: pluginDataDirectory(home, "probe"),
  };
}

function childEnvironment(
  fixture: ReturnType<typeof writePluginFixture>,
  nested: boolean
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: fixture.home,
    USERPROFILE: fixture.home,
    TIDESURF_EXTENSIONS: "user",
    TIDESURF_PLUGINS_DIR: fixture.pluginsRoot,
  };
  if (nested) env.TIDESURF_PLUGIN_MCP_CHILD = "1";
  else delete env.TIDESURF_PLUGIN_MCP_CHILD;
  return env;
}

async function closeEvent(
  child: ChildProcessWithoutNullStreams,
  timeoutMs = 8_000
): Promise<[number | null, NodeJS.Signals | null]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error("MCP child did not exit within its shutdown grace")),
      timeoutMs
    );
  });
  try {
    return await Promise.race([
      once(child, "close") as Promise<[number | null, NodeJS.Signals | null]>,
      timeout,
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function exerciseMcp(
  fixture: ReturnType<typeof writePluginFixture>,
  args: string[],
  nested = false,
  waitForPluginSpawn = false
): Promise<string[]> {
  const child = spawn(process.execPath, [cliPath, ...args], {
    cwd: root,
    env: childEnvironment(fixture, nested),
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stderr: Buffer[] = [];
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  const lines = createInterface({ input: child.stdout });
  const iterator = lines[Symbol.asyncIterator]();
  const response = async (id: number): Promise<Record<string, unknown>> => {
    for (;;) {
      const next = await iterator.next();
      if (next.done) {
        throw new Error(`MCP stdout closed: ${Buffer.concat(stderr).toString("utf8")}`);
      }
      const value = JSON.parse(next.value) as Record<string, unknown>;
      if (value.id === id) return value;
    }
  };

  try {
    child.stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "plugin-host-test", version: "1" },
      },
    })}\n`);
    expect((await response(1)).result).toBeTruthy();
    child.stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    })}\n`);
    if (waitForPluginSpawn) await waitForFile(fixture.marker);
    child.stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    })}\n`);
    const listed = await response(2) as {
      result?: { tools?: Array<{ name?: string }> };
    };
    expect(listed.result).toBeTruthy();
    child.stdin.end();
    const [code] = await closeEvent(child);
    expect(code).toBe(0);
    return (listed.result?.tools ?? []).flatMap((entry) =>
      typeof entry.name === "string" ? [entry.name] : []
    );
  } finally {
    lines.close();
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}

async function waitForFile(path: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error(`fixture did not create ${path}`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
  }
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("CLI MCP plugin-host guards", () => {
  it("declares only the packed local Node CLI in mcp.json", () => {
    const manifest = JSON.parse(readFileSync(join(root, "mcp.json"), "utf8"));
    expect(manifest.mcpServers).toEqual({
      tidesurf: {
        type: "stdio",
        command: "node",
        args: ["${PLUGIN_ROOT}/dist/cli.js", "mcp"],
        cwd: "${PLUGIN_ROOT}",
      },
    });
    expect(JSON.stringify(manifest)).not.toContain("npx");
    expect(JSON.stringify(manifest)).not.toContain("https://registry");
  });

  it("uses the positive-control plugin, but never spawns or creates data in read-only mode", async () => {
    const control = writePluginFixture();
    const controlTools = await exerciseMcp(
      control,
      ["mcp", "--quiet"],
      false,
      true
    );
    expect(readFileSync(control.marker, "utf8")).toBe("1");
    expect(existsSync(control.dataDirectory)).toBe(true);
    expect(controlTools).toContain("probe__probe_tool");

    const readOnly = writePluginFixture();
    const readOnlyTools = await exerciseMcp(
      readOnly,
      ["--read-only", "mcp", "--quiet"]
    );
    expect(existsSync(readOnly.marker)).toBe(false);
    expect(existsSync(readOnly.dataDirectory)).toBe(false);
    expect(readOnlyTools).not.toContain("probe__probe_tool");
  }, 20_000);

  it("suppresses nested plugin proxying and its data-directory side effect", async () => {
    const fixture = writePluginFixture();
    const tools = await exerciseMcp(fixture, ["mcp", "--quiet"], true);
    expect(existsSync(fixture.marker)).toBe(false);
    expect(existsSync(fixture.dataDirectory)).toBe(false);
    expect(tools).not.toContain("probe__probe_tool");
  }, 10_000);

  it("handles SIGINT, SIGTERM, and stdin EOF while plugin startup is pending", async () => {
    if (process.platform === "win32") return;
    const cases = [
      { action: "SIGINT" as const, code: 130 },
      { action: "SIGTERM" as const, code: 143 },
      { action: "stdin" as const, code: 0 },
    ];
    for (const entry of cases) {
      const fixture = writePluginFixture({ hang: true });
      const child = spawn(process.execPath, [cliPath, "mcp", "--quiet"], {
        cwd: root,
        env: childEnvironment(fixture, false),
        stdio: ["pipe", "pipe", "pipe"],
      });
      try {
        await waitForFile(fixture.marker);
        const pluginPid = Number(readFileSync(fixture.marker, "utf8"));
        expect(Number.isSafeInteger(pluginPid)).toBe(true);
        if (entry.action === "stdin") child.stdin.end();
        else child.kill(entry.action);
        let closed: [number | null, NodeJS.Signals | null];
        try {
          closed = await closeEvent(child);
        } catch (error) {
          throw new Error(`${entry.action} shutdown failed`, { cause: error });
        }
        const [code, signal] = closed;
        expect(signal).toBeNull();
        expect(code).toBe(entry.code);
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
        expect(processExists(pluginPid)).toBe(false);
      } finally {
        if (child.exitCode === null) child.kill("SIGKILL");
      }
    }
  }, 20_000);
});
