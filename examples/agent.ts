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

// Convert our tool definitions to Anthropic format
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
  // Agent loop
  for (let step = 0; step < 20; step++) {
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system:
        "You are a web browsing agent. Use the provided tools to navigate and interact with web pages. " +
        "Always call get_state first to see the page. Be concise in your responses.",
      tools,
      messages,
    });

    // Collect assistant text + tool calls
    messages.push({ role: "assistant", content: response.content });

    // Print any text the model says
    for (const block of response.content) {
      if (block.type === "text") {
        console.log(`Agent: ${block.text}`);
      }
    }

    // If the model is done (no tool use), break
    if (response.stop_reason === "end_turn") break;

    // Execute tool calls
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const block of response.content) {
      if (block.type !== "tool_use") continue;

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
