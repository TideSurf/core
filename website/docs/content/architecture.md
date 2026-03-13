# Architecture

TideSurf sits between your LLM agent and a Chromium browser, acting as a bidirectional translator: it compresses the live DOM into token-efficient XML for the agent, and converts the agent's tool calls into browser commands via the Chrome DevTools Protocol (CDP).

## System overview

```
                                                    ┌──────────────────┐
                                              ┌───► │ Chrome (launched) │
┌─────────┐     tool calls      ┌──────────┐ │     └──────────────────┘
│  Agent   │ ◄────────────────► │ TideSurf │─┤ CDP
│ (any LLM)│   standard tools   │          │ │     ┌──────────────────┐
└─────────┘                     └──────────┘ └───► │ Chrome (running) │
                                  launch()          └──────────────────┘
                                  connect()   ▲ auto-connect
```

TideSurf provides two connection modes:

- **`TideSurf.launch()`** — spawns a new Chrome process, owns its lifecycle, cleans up on close
- **`TideSurf.connect()`** — attaches to a Chrome instance that's already running (with remote debugging enabled). Does not manage the process — `close()` only disconnects CDP

## Data flow

The information flows through TideSurf in two directions, each with a distinct transformation step:

**Reading (browser → agent):** When the agent requests the page state, TideSurf fetches the live DOM via CDP, walks the tree to strip presentational attributes, collapses redundant nesting, assigns short IDs to interactive elements, and emits a compact XML document. The raw DOM might contain tens of thousands of tokens; the compressed output typically lands between 100 and 800.

```
Raw web page → Chromium renders → Live DOM → TideSurf compresses → Agent-ready XML
```

**Writing (agent → browser):** When the agent calls a tool like `click("B1")` or `type("I1", "hello")`, TideSurf resolves the short ID to a real DOM node using its internal node map, then executes the corresponding CDP command (dispatching click events, injecting keystrokes, triggering form submissions, etc.).

```
Agent tool call → TideSurf resolves ID → CDP command → Browser executes action
```

## Key components

### DOM Compressor

The core of TideSurf — a recursive tree walker that traverses the rendered DOM and makes keep/strip decisions for every node. It applies heuristics to identify interactive elements (inputs, buttons, links), semantic containers (nav, form, headings), and visible text, while discarding CSS classes, inline styles, wrapper divs, script/style tags, hidden elements, and other presentational noise.

When a token budget is set via `maxTokens`, the compressor runs a second pass that prioritizes interactive elements over passive content and prunes from the bottom of the priority stack until the output fits within the budget.

### Node map

An in-memory map that links each short ID (like `B1`, `L3`, `I2`) back to the actual DOM node's CDP object reference. This map is rebuilt every time `getState()` is called, ensuring that IDs always correspond to the current state of the page. When the agent calls `click("B1")`, TideSurf looks up `B1` in this map to find the real node and execute the action.

### CDP connector

Manages the WebSocket connection to Chrome's DevTools Protocol. Handles connection lifecycle, automatic reconnection on transient failures, and multiplexing commands across multiple tabs. Each tab has its own CDP session, enabling independent state management.

In auto-connect mode, the connector uses `discoverBrowser()` to probe `CDP.List()` on the target port, verifying that Chrome is reachable and has at least one open page tab before establishing a connection.

### Tool layer

Exposes TideSurf's capabilities as a set of 12 standardized tool definitions that follow common LLM function-calling conventions. These definitions include parameter schemas, descriptions, and type information that help the LLM understand what each tool does and when to use it. The tool executor validates incoming calls, dispatches them to the appropriate method, and returns structured results.

## Design principles

- **Token efficiency over completeness** — the compressed output deliberately omits information that doesn't help an agent decide its next action. Visual styling, layout details, and decorative elements add tokens without adding utility.
- **Stable, predictable IDs** — short prefixed IDs (`B1`, `L3`) are more reliable for LLMs than CSS selectors or XPaths, which can be brittle and verbose. The prefix tells the LLM the element type at a glance.
- **Standard tools, any model** — by using a generic tool-calling interface, TideSurf works with Claude, GPT, Gemini, open-source models, or anything else that supports function calling. No vendor lock-in.
