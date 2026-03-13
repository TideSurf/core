/**
 * TideSurf HTTP bridge — a local JSON API server for Claude Code's /surf skill.
 * Powered by Elysia.
 *
 * Usage:
 *   bun examples/surf-server.ts [--headful] [--port 7370]
 *
 * Endpoints:
 *   POST /        — Execute a single tool: {"name":"navigate","input":{"url":"..."}}
 *   POST /batch   — Execute multiple tools sequentially: [cmd1, cmd2, ...]
 *   GET  /health  — Check if server is running
 *   POST /quit    — Graceful shutdown
 */

import { Elysia, t } from "elysia";
import { TideSurf } from "../src/index.js";
import { validatePort } from "../src/validation.js";

const headful = process.argv.includes("--headful");
const portIdx = process.argv.indexOf("--port");
const port = portIdx !== -1 ? Number.parseInt(process.argv[portIdx + 1] ?? "", 10) : 7370;
validatePort(port);

console.error(`[tidesurf] Launching browser (${headful ? "headful" : "headless"})...`);
const surfing = await TideSurf.launch({ headless: !headful });
const executor = surfing.getToolExecutor();
console.error(`[tidesurf] Ready on http://127.0.0.1:${port}`);

async function execOne(cmd: { name: string; input?: Record<string, unknown> }) {
  return executor({ name: cmd.name, input: cmd.input ?? {} });
}

const app = new Elysia()
  .get("/health", () => ({ status: "ok" }))
  .post("/quit", async () => {
    setTimeout(async () => {
      await surfing.close();
      process.exit(0);
    }, 100);
    return { success: true, data: "shutting down" };
  })
  .post(
    "/",
    async ({ body }) => execOne(body),
    {
      body: t.Object({
        name: t.String(),
        input: t.Optional(t.Record(t.String(), t.Unknown())),
      }),
    }
  )
  .post(
    "/batch",
    async ({ body }) => {
      const results = [];
      for (const cmd of body) {
        results.push(await execOne(cmd));
      }
      return results;
    },
    {
      body: t.Array(
        t.Object({
          name: t.String(),
          input: t.Optional(t.Record(t.String(), t.Unknown())),
        })
      ),
    }
  )
  .onError(({ error }) => ({
    success: false,
    error: error instanceof Error ? error.message : String(error),
  }))
  .listen({ hostname: "127.0.0.1", port });
