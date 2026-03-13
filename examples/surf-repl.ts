/**
 * TideSurf REPL — reads JSON tool commands from stdin, prints results to stdout.
 * Designed to be driven by Claude Code's /surf skill.
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

try {
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop()!; // keep incomplete last line in buffer

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed === "quit" || trimmed === "exit") {
        await surfing.close();
        console.error("[tidesurf] Browser closed.");
        process.exit(0);
      }

      try {
        const cmd = JSON.parse(trimmed);
        const result = await executor({
          name: cmd.name,
          input: cmd.input ?? {},
        });

        console.log(JSON.stringify(result));
      } catch (err) {
        console.log(
          JSON.stringify({
            success: false,
            error: err instanceof Error ? err.message : String(err),
          })
        );
      }
    }
  }

  // Process any remaining buffer
  if (buffer.trim() && buffer.trim() !== "quit") {
    try {
      const cmd = JSON.parse(buffer.trim());
      const result = await executor({
        name: cmd.name,
        input: cmd.input ?? {},
      });
      console.log(JSON.stringify(result));
    } catch {
      // ignore trailing incomplete input
    }
  }
} finally {
  await surfing.close();
  console.error("[tidesurf] Browser closed.");
}
