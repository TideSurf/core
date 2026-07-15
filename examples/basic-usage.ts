import { TideSurf } from "../src/index.js";

async function main() {
  console.log("Launching TideSurf...");

  const surfing = await TideSurf.launch({ headless: true });

  try {
    const tools = surfing.getToolDefinitions();
    console.log(`\nAvailable tools (${tools.length}):`);
    for (const tool of tools) {
      console.log(`  - ${tool.name}: ${tool.description.slice(0, 60)}...`);
    }

    console.log("\nNavigating to example.com...");
    await surfing.navigate("https://example.com");

    const state = await surfing.readPage();
    console.log(`\nPage: ${state.title} (${state.url})`);
    console.log(`\nCompressed DOM (${state.content.length} chars):`);
    console.log(state.content);
    console.log(`\nNode map entries: ${state.nodeMap.size}`);

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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
