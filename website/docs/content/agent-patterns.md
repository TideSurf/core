# Agent patterns

Small, reusable patterns for TideSurf agent loops.

## Basic agent loop

Read state → send it to the model → execute the selected tool → repeat.
Set `ANTHROPIC_MODEL` to a model available to your account instead of pinning a dated model ID in source.

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { TideSurf } from "@tidesurf/core";

const client = new Anthropic();
const model = process.env["ANTHROPIC_MODEL"];
if (!model) throw new Error("Set ANTHROPIC_MODEL to a model available to your account");
const browser = await TideSurf.launch();
const executor = browser.getToolExecutor();

// Anthropic names the JSON Schema field input_schema.
const tools = browser.getToolDefinitions().map(t => ({
  name: t.name,
  description: t.description,
  input_schema: t.input_schema as Anthropic.Tool["input_schema"],
}));

const messages: Anthropic.MessageParam[] = [
  { role: "user", content: "Go to news.ycombinator.com and find the top story" },
];

try {
  while (true) {
    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      tools,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    const toolCalls = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
    );
    if (toolCalls.length === 0) {
      if (response.stop_reason !== "end_turn" && response.stop_reason !== "stop_sequence") {
        throw new Error(`Agent stopped without a tool call: ${response.stop_reason ?? "unknown"}`);
      }
      const text = response.content.find(b => b.type === "text");
      if (text) console.log(text.text);
      break;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolCalls) {
      const result = await executor({ name: block.name, input: block.input as Record<string, unknown> });
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(result),
      });
    }

    messages.push({ role: "user", content: toolResults });
  }
} finally {
  await browser.close();
}
```

## Scoped observation (read-only)

Observe a page without exposing mutation tools:

```typescript
const browser = await TideSurf.connect({ readOnly: true });
const state = await browser.getState();
console.log(state.content);
await browser.close();
```

## Authenticated sessions

Start Chrome with remote debugging, log in manually, then attach:

```typescript
const browser = await TideSurf.connect({ port: 9222 });
const state = await browser.getState();
console.log(state.content);
```

## Token-efficient browsing

Long sessions can request only the context needed next:

```typescript
const page = browser.getPage();

const overview = await browser.getState({ mode: "interactive", maxTokens: 200 });

await page.click("B1");
const detail = await browser.getState({ maxTokens: 500 });

const results = await page.search("error message");
```

## Multi-tab workflows

Compare two versions across tabs:

```typescript
const browser = await TideSurf.launch();

await browser.navigate("https://docs.example.com/v1/api");
const tab1 = (await browser.listTabs())[0];

const tab2 = await browser.newTab("https://docs.example.com/v2/api");

await browser.switchTab(tab1.id);
const v1 = await browser.getState();

await browser.switchTab(tab2.id);
const v2 = await browser.getState();
```

Send `v1.content` and `v2.content` to the model for comparison.

## Form filling

Fill a form from fresh interactive state. The state exposes controls such as `I1 ~First name`, `I2 ~Email`, `S1:select`, and `[B1] Submit`:

```typescript
const page = browser.getPage();

const state = await browser.getState({ mode: "interactive" });

await page.type("I1", "Alice", true);
await page.type("I2", "alice@example.com", true);
await page.select("S1", "enterprise");
await page.click("B1");

const result = await browser.getState();
```
