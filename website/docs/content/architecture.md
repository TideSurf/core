# Architecture

TideSurf connects an LLM agent to Chromium. It compresses the live DOM into agent-readable text and resolves tool calls back to browser actions through CDP.

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

Two connection modes share the same API:

- **`TideSurf.launch()`** starts, owns, and cleans up a Chrome process.
- **`TideSurf.connect()`** attaches to Chrome with remote debugging enabled; `close()` only disconnects CDP.

## Data flow

Data moves in two directions:

**Browser → agent:** TideSurf fetches the live DOM, removes presentation, checks computed visibility and control state, collapses redundant nesting, assigns action IDs, and emits compact text. Tens of thousands of DOM tokens commonly become 100–800.

```
Raw web page → Chromium renders → Live DOM → Computed visibility check → State detection → TideSurf compresses → Agent-ready text
```

**Agent → browser:** A call such as `click("B1")` or `type("I1", "hello")` resolves through the node map to a live DOM node, followed by the corresponding CDP command.

```
Agent tool call → TideSurf resolves ID → CDP command → Browser executes action
```

## Key components

**DOM compressor**

The DOM compressor is a recursive tree walker. It retains usable controls, semantic containers, and visible text; classes, inline styles, wrappers, scripts, hidden nodes, and other presentational noise drop away. A computed-style pass checks `display`, `visibility`, `opacity`, `clip-path`, and `pointer-events`. The serializer encodes surviving control state through `~~strikethrough~~` and short keyword suffixes.

`maxTokens` adds a second pass that favors controls over passive copy and prunes lower-priority content to fit.

**Node map**

An in-memory node map links IDs such as `B1`, `L3`, and `I2` to CDP object references. Each `getState()` rebuilds it against the current page. `click("B1")` uses that map to find the live node.

**CDP connector**

The connector owns the CDP WebSocket lifecycle, transient reconnection, and commands across tabs. Every tab has an independent CDP session.

Auto-connect uses `discoverBrowser()` and `CDP.List()` to confirm a reachable Chrome instance with an open page tab.

**Tool layer**

The tool layer exposes 18 provider-neutral function schemas. It validates calls, dispatches the matching method, and returns structured results.

## Design principles

- **Useful context first:** presentation drops out so the agent can choose its next action.
- **Predictable IDs:** short handles such as `B1` and `L3` are clearer than brittle selectors or XPath.
- **Provider-neutral tools:** the same schemas work across function-calling models.
- **Read-only surface:** observation sessions omit write tools from both definitions and execution.
