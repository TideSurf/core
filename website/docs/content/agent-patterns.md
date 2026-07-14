# Agent patterns

Small, reusable patterns for TideSurf agent loops.

## Basic agent loop

Read state → send it to the model → execute the selected tool → repeat.

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { TideSurf, getToolDefinitions } from "@tidesurf/core";

const client = new Anthropic();
const browser = await TideSurf.launch();
const executor = browser.getToolExecutor();

// Adapt TideSurf tools to Anthropic format.
const tools = getToolDefinitions().map(t => ({
  name: t.name,
  description: t.description,
  input_schema: t.input_schema,
}));

const messages: Anthropic.MessageParam[] = [
  { role: "user", content: "Go to news.ycombinator.com and find the top story" },
];

while (true) {
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    tools,
    messages,
  });

  // Keep the assistant response in the conversation.
  messages.push({ role: "assistant", content: response.content });

  if (response.stop_reason === "end_turn") {
    // Print the model's final text.
    const text = response.content.find(b => b.type === "text");
    if (text) console.log(text.text);
    break;
  }

  // Execute every requested tool.
  const toolResults: Anthropic.ToolResultBlockParam[] = [];
  for (const block of response.content) {
    if (block.type !== "tool_use") continue;
    const result = await executor({ name: block.name, input: block.input as Record<string, unknown> });
    toolResults.push({
      type: "tool_result",
      tool_use_id: block.id,
      content: result.success ? String(result.data) : `Error: ${result.error}`,
    });
  }

  messages.push({ role: "user", content: toolResults });
}

await browser.close();
```

## Scoped observation (read-only)

Observe a page without exposing mutation tools:

```typescript
const browser = await TideSurf.connect({ readOnly: true });
const state = await browser.getState();
// The agent can observe, search, and screenshot.
await browser.close();
```

## Authenticated sessions

Attach to a trusted, logged-in Chrome session:

```typescript
// 1. Open Chrome with remote debugging enabled
// 2. Log in manually
// 3. Connect TideSurf
const browser = await TideSurf.connect({ port: 9222 });
const state = await browser.getState();
// state.content reflects the authenticated page.
```

## Token-efficient browsing

Long sessions can request only the context needed next:

```typescript
// Begin with controls.
const overview = await browser.getState({ mode: "interactive", maxTokens: 200 });

// Read more context after the action.
await page.click("B1");
const detail = await browser.getState({ maxTokens: 500 });

// Search for targeted lookups.
const results = await page.search("error message");
```

## Multi-tab workflows

Compare two versions across tabs:

```typescript
const browser = await TideSurf.launch();

// Open both versions.
await browser.navigate("https://docs.example.com/v1/api");
const tab1 = (await browser.listTabs())[0];

const tab2 = await browser.newTab("https://docs.example.com/v2/api");

// Read both states.
await browser.switchTab(tab1.id);
const v1 = await browser.getState();

await browser.switchTab(tab2.id);
const v2 = await browser.getState();

// Send v1.content and v2.content to the model.
```

## Form filling

Fill a form from fresh interactive state:

```typescript
const page = browser.getPage();

// Read the current controls.
const state = await browser.getState({ mode: "interactive" });
// state.content shows: I1 ~First name  I2 ~Email  S1:select  [B1] Submit

await page.type("I1", "Alice", true);
await page.type("I2", "alice@example.com", true);
await page.select("S1", "enterprise");
await page.click("B1");

// Verify the result.
const result = await browser.getState();
```
