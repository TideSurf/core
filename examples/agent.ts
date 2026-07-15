/**
 * Example: TideSurf + Claude agent loop
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... ANTHROPIC_MODEL=<model-id> bun examples/agent.ts "Go to Hacker News and tell me the top 3 stories"
 */

import Anthropic from "@anthropic-ai/sdk";
import { TideSurf } from "../src/index.js";

const task = process.argv[2];
if (!task) {
  console.error("Usage: bun examples/agent.ts \"<task description>\"");
  process.exit(1);
}

const client = new Anthropic();
const model = process.env["ANTHROPIC_MODEL"];
if (!model) {
  console.error("Set ANTHROPIC_MODEL to a model available to your account");
  process.exit(1);
}
const surfing = await TideSurf.launch({ headless: true });
const executor = surfing.getToolExecutor();

// Anthropic names the JSON Schema field input_schema.
const tools = surfing.getToolDefinitions().map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: t.input_schema as Anthropic.Tool["input_schema"],
}));

const messages: Anthropic.MessageParam[] = [
  { role: "user", content: task },
];

console.log(`\nTask: ${task}\n`);

try {
  for (let step = 0; step < 20; step++) {
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: "Call get_state before choosing current IDs. Use the tools to complete the task, then return a concise answer.",
      tools,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    for (const block of response.content) {
      if (block.type === "text") {
        console.log(`Agent: ${block.text}`);
      }
    }

    const toolCalls = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
    );
    if (toolCalls.length === 0) {
      if (
        response.stop_reason === "end_turn" ||
        response.stop_reason === "stop_sequence"
      ) {
        break;
      }
      throw new Error(
        `Agent stopped without a tool call: ${response.stop_reason ?? "unknown"}`
      );
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const block of toolCalls) {
      console.log(`  → ${block.name}(${JSON.stringify(block.input)})`);

      const result = await executor({
        name: block.name,
        input: block.input as Record<string, unknown>,
      });

      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(result),
      });
    }

    messages.push({ role: "user", content: toolResults });
  }
} finally {
  await surfing.close();
}
