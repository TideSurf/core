import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { TideSurf } from "../../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "..", "fixtures");

let server: Server;
let serverPort: number;
let surfing: TideSurf;

describe("Browser integration", () => {
  beforeAll(async () => {
    server = createServer(async (req, res) => {
      const pathname = req.url ?? "/";
      const filename = pathname === "/" ? "basic.html" : pathname.slice(1);
      try {
        const content = await readFile(join(fixturesDir, filename), "utf-8");
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(content);
      } catch {
        res.writeHead(404);
        res.end("Not found");
      }
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    serverPort = typeof addr === "object" && addr ? addr.port : 0;

    surfing = await TideSurf.launch({ headless: true, port: 9333 });
  }, 60000);

  afterAll(async () => {
    await surfing?.close();
    server?.close();
  });

  it("navigates and gets page state", async () => {
    await surfing.navigate(`http://localhost:${serverPort}/`);
    const state = await surfing.getState();

    expect(state.url).toContain(`localhost:${serverPort}`);
    expect(state.title).toBe("Test Page");
    expect(state.xml).toContain("<page");
    expect(state.xml).toContain("</page>");

    // Should contain interactive elements with IDs
    expect(state.xml).toContain("L1");
    expect(state.xml).toContain("B1");
    expect(state.xml).toContain("I1");

    // Should NOT contain scripts
    expect(state.xml).not.toContain("alert");
    expect(state.xml).not.toContain("<script");

    // Should NOT contain aria-hidden content
    expect(state.xml).not.toContain("Hidden content");
  }, 15000);

  it("clicks a button", async () => {
    await surfing.navigate(`http://localhost:${serverPort}/interactive.html`);
    const state = await surfing.getState();

    expect(state.xml).toContain("button");

    const page = surfing.getPage();
    await page.click("B1");

    const result = await page.evaluate(
      "document.getElementById('output').textContent"
    );
    expect(result).toBe("clicked!");
  }, 15000);

  it("types into an input", async () => {
    await surfing.navigate(`http://localhost:${serverPort}/interactive.html`);
    await surfing.getState();

    const page = surfing.getPage();
    await page.type("I1", "hello world");

    const value = await page.evaluate(
      "document.getElementById('search').value"
    );
    expect(value).toBe("hello world");
  }, 15000);

  it("selects a dropdown option", async () => {
    await surfing.navigate(`http://localhost:${serverPort}/interactive.html`);
    await surfing.getState();

    const page = surfing.getPage();
    await page.select("S1", "blue");

    const value = await page.evaluate(
      "document.getElementById('color').value"
    );
    expect(value).toBe("blue");
  }, 15000);

  it("tool executor works", async () => {
    await surfing.navigate(`http://localhost:${serverPort}/`);
    const executor = surfing.getToolExecutor();

    const result = await executor({
      name: "get_state",
      input: {},
    });

    expect(result.success).toBe(true);
    expect(typeof result.data).toBe("string");
    expect(result.data as string).toContain("<page");
  }, 15000);

  it("returns tool definitions", () => {
    const defs = surfing.getToolDefinitions();
    expect(defs).toHaveLength(18);
    expect(defs.map((d) => d.name)).toEqual(
      expect.arrayContaining([
        "get_state",
        "navigate",
        "click",
        "type",
        "select",
        "scroll",
        "extract",
        "evaluate",
        "list_tabs",
        "new_tab",
        "switch_tab",
        "close_tab",
        "search",
        "screenshot",
        "upload",
        "clipboard_read",
        "clipboard_write",
        "download",
      ])
    );
  });
});
