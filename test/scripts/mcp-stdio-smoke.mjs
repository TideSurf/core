import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";

const cli = process.argv[2];
if (!cli) throw new Error("Usage: mcp-stdio-smoke.mjs <cli.js>");

const child = spawn(process.execPath, [cli, "mcp", "--quiet"], {
  stdio: ["pipe", "pipe", "inherit"],
});
const lines = createInterface({ input: child.stdout });
const iterator = lines[Symbol.asyncIterator]();

function send(value) {
  child.stdin.write(`${JSON.stringify(value)}\n`);
}

async function response(id) {
  while (true) {
    const next = await iterator.next();
    if (next.done) throw new Error("MCP server closed before responding");
    const value = JSON.parse(next.value);
    if (value.id === id) return value;
  }
}

try {
  send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "pack-smoke", version: "1" },
    },
  });
  const initialized = await response(1);
  if (!initialized.result) throw new Error("MCP initialize failed");
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  const listed = await response(2);
  if (listed.result?.tools?.length !== 19) {
    throw new Error(`Expected 19 MCP tools, received ${listed.result?.tools?.length}`);
  }

  child.stdin.end();
  const closed = once(child, "close");
  const timeout = new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error("MCP server ignored EOF")), 10_000);
    timer.unref?.();
  });
  const [code] = await Promise.race([closed, timeout]);
  if (code !== 0) throw new Error(`MCP server exited with ${code}`);
} finally {
  lines.close();
  if (child.exitCode === null) child.kill("SIGKILL");
}
