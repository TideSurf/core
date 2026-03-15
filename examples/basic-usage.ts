import { TideSurf, getToolDefinitions } from "../src/index.js";

async function main() {
  console.log("Launching TideSurf...");

  const surfing = await TideSurf.launch({ headless: true });

  try {
    // Show tool definitions (what you'd pass to an LLM)
    const tools = getToolDefinitions();
    console.log(`\nAvailable tools (${tools.length}):`);
    for (const tool of tools) {
      console.log(`  - ${tool.name}: ${tool.description.slice(0, 60)}...`);
    }

    // Navigate to a page
    console.log("\nNavigating to example.com...");
    await surfing.navigate("https://example.com");

    // Get compressed page state
    const state = await surfing.getState();
    console.log(`\nPage: ${state.title} (${state.url})`);
    console.log(`\nCompressed DOM (${state.content.length} chars):`);
    console.log(state.content);
    console.log(`\nNode map entries: ${state.nodeMap.size}`);

    // Use the tool executor (simulating what an LLM agent would do)
    const executor = surfing.getToolExecutor();

    const result = await executor({
      name: "get_state",
      input: {},
    });

    if (result.success) {
      console.log("\nTool executor get_state succeeded.");
    }
  } finally {
    await surfing.close();
    console.log("\nBrowser closed.");
  }
}

main().catch(console.error);
