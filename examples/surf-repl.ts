/**
 * TideSurf SDK stream example. For normal shell use, prefer
 * `tidesurf call <tool> --input <json|->`, which keeps a named session alive.
 *
 * Usage:
 *   echo '{"name":"navigate","input":{"url":"https://example.com"}}' | bun examples/surf-repl.ts
 *
 * Or interactively:
 *   bun examples/surf-repl.ts
 *   > {"name":"navigate","input":{"url":"https://example.com"}}
 *   > {"name":"get_state","input":{}}
 *   > quit
 */

import { TideSurf } from "../src/index.js";

const headless = !process.argv.includes("--headful");
const surfing = await TideSurf.launch({ headless });
const executor = surfing.getToolExecutor();

console.error("[tidesurf] Browser launched. Send JSON commands, one per line. Send 'quit' to exit.");

const decoder = new TextDecoder();
const reader = Bun.stdin.stream().getReader();
let buffer = "";

async function executeLine(line: string): Promise<boolean> {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (trimmed === "quit" || trimmed === "exit") return false;

  try {
    const cmd = JSON.parse(trimmed) as {
      name?: unknown;
      input?: unknown;
    };
    if (typeof cmd.name !== "string") {
      throw new Error("Command name must be a string");
    }
    const result = await executor({
      name: cmd.name,
      input: (cmd.input === undefined ? {} : cmd.input) as Record<string, unknown>,
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.log(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      })
    );
  }

  return true;
}

try {
  let running = true;
  while (running) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      running = await executeLine(line);
      if (!running) break;
    }
  }

  if (running) await executeLine(buffer);
} finally {
  await surfing.close();
  console.error("[tidesurf] Browser closed.");
}
