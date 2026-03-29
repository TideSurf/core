# Agent patterns

Common patterns for building LLM-powered browser agents with TideSurf.

## Basic agent loop

The standard pattern: get state → send to LLM → execute tool call → repeat.

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { TideSurf, getToolDefinitions } from "@tidesurf/core";

const client = new Anthropic();
const browser = await TideSurf.launch();
const executor = browser.getToolExecutor();

// Convert TideSurf tools to Anthropic format
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

  // Collect assistant response
  messages.push({ role: "assistant", content: response.content });

  if (response.stop_reason === "end_turn") {
    // LLM is done — print final text
    const text = response.content.find(b => b.type === "text");
    if (text) console.log(text.text);
    break;
  }

  // Execute tool calls
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

Monitor a page without risk of modification:

```typescript
const browser = await TideSurf.connect({ readOnly: true });
const state = await browser.getState();
// Feed state.content to your LLM for analysis
// The agent can observe, search, and screenshot — but cannot click, type, or navigate
await browser.close();
```

## Authenticated sessions

Connect to your logged-in Chrome to access pages behind authentication:

```typescript
// 1. Open Chrome with remote debugging enabled
// 2. Log in manually
// 3. Connect TideSurf
const browser = await TideSurf.connect({ port: 9222 });
const state = await browser.getState();
// Your agent now sees the authenticated page
```

## Token-efficient browsing

For long agent sessions, minimize token usage:

```typescript
// Start with interactive-only mode to see what's actionable
const overview = await browser.getState({ mode: "interactive", maxTokens: 200 });

// After clicking, get full viewport for context
await page.click("B1");
const detail = await browser.getState({ maxTokens: 500 });

// Use search instead of getState for targeted lookups
const results = await page.search("error message");
```

## Multi-tab workflows

Compare content across tabs:

```typescript
const browser = await TideSurf.launch();

// Open two tabs
await browser.navigate("https://docs.example.com/v1/api");
const tab1 = (await browser.listTabs())[0];

const tab2 = await browser.newTab("https://docs.example.com/v2/api");

// Get state from both
await browser.switchTab(tab1.id);
const v1 = await browser.getState();

await browser.switchTab(tab2.id);
const v2 = await browser.getState();

// Feed both to your LLM for comparison
```

## Form filling

Automate multi-step form submission:

```typescript
const page = browser.getPage();

// Get form state
const state = await browser.getState({ mode: "interactive" });
// state.content shows: I1 ~First name  I2 ~Email  S1:select  [B1] Submit

await page.type("I1", "Alice", true);
await page.type("I2", "alice@example.com", true);
await page.select("S1", "enterprise");
await page.click("B1");

// Verify result
const result = await browser.getState();
```
