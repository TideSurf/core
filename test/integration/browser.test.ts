import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { TideSurf } from "../../src/index.js";
import { ElementNotFoundError } from "../../src/errors.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "..", "fixtures");

let surfing: TideSurf;
let fixtureUrls: Record<string, string> = {};

function toDataUrl(html: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

async function canLaunchBrowser(): Promise<boolean> {
  let browser: TideSurf | null = null;
  try {
    browser = await TideSurf.launch({ headless: true, port: 9332 });
    return true;
  } catch {
    return false;
  } finally {
    await browser?.close().catch(() => {});
  }
}

const browserAvailable = await canLaunchBrowser();
const describeBrowser = browserAvailable ? describe : describe.skip;

if (!browserAvailable) {
  console.warn("Skipping browser integration tests: Chrome could not be launched in this environment.");
}

describeBrowser("Browser integration", () => {
  beforeAll(async () => {
    const fixtureNames = [
      "basic.html",
      "interactive.html",
      "shadow.html",
      "iframe-parent.html",
      "advanced-tools.html",
    ] as const;
    const entries = await Promise.all(
      fixtureNames.map(async (name) => [name, toDataUrl(await readFile(join(fixturesDir, name), "utf-8"))] as const)
    );
    fixtureUrls = Object.fromEntries(entries);

    surfing = await TideSurf.launch({ headless: true, port: 9333 });
  }, 60000);

  afterAll(async () => {
    await surfing?.close();
  });

  it("navigates and gets page state", async () => {
    await surfing.navigate(fixtureUrls["basic.html"]);
    const state = await surfing.getState();

    expect(state.url).toContain("data:text/html");
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
    await surfing.navigate(fixtureUrls["interactive.html"]);
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
    await surfing.navigate(fixtureUrls["interactive.html"]);
    await surfing.getState();

    const page = surfing.getPage();
    await page.type("I1", "hello world");

    const value = await page.evaluate(
      "document.getElementById('search').value"
    );
    expect(value).toBe("hello world");
  }, 15000);

  it("selects a dropdown option", async () => {
    await surfing.navigate(fixtureUrls["interactive.html"]);
    await surfing.getState();

    const page = surfing.getPage();
    await page.select("S1", "blue");

    const value = await page.evaluate(
      "document.getElementById('color').value"
    );
    expect(value).toBe("blue");
  }, 15000);

  it("tool executor works", async () => {
    await surfing.navigate(fixtureUrls["basic.html"]);
    const executor = surfing.getToolExecutor();

    const result = await executor({
      name: "get_state",
      input: {},
    });

    expect(result.success).toBe(true);
    expect(typeof result.data).toBe("string");
    expect(result.data as string).toContain("<page");
  }, 15000);

  it("search returns nearest interactive element IDs", async () => {
    await surfing.navigate(fixtureUrls["interactive.html"]);

    const results = await surfing.getPage().search("Action");

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      tag: "button",
      elementId: "B1",
    });
  }, 15000);

  it("viewport mode keeps visible shadow and iframe content", async () => {
    await surfing.navigate(fixtureUrls["shadow.html"]);
    const shadowState = await surfing.getState({ viewport: true });
    expect(shadowState.xml).toContain("Shadow Button");

    await surfing.navigate(fixtureUrls["iframe-parent.html"]);
    const iframeState = await surfing.getState({ viewport: true });
    expect(iframeState.xml).toContain("Child Link");
  }, 15000);

  it("closing the initial active tab keeps the session usable", async () => {
    const initialTabs = await surfing.listTabs();
    expect(initialTabs).toHaveLength(1);

    await surfing.closeTab(initialTabs[0].id);

    const remainingTabs = await surfing.listTabs();
    expect(remainingTabs.length).toBeGreaterThan(0);

    await surfing.navigate(fixtureUrls["basic.html"]);
    const state = await surfing.getState();
    expect(state.title).toBe("Test Page");
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

  it("filters nodeMap entries down to the IDs actually present in the response", async () => {
    await surfing.navigate(fixtureUrls["interactive.html"]);
    const state = await surfing.getState({ mode: "minimal" });

    expect(state.xml).not.toContain('id="B1"');
    expect(state.nodeMap.has("B1")).toBe(false);

    const page = surfing.getPage();
    await expect(page.click("B1")).rejects.toThrow(ElementNotFoundError);
  }, 15000);

  it("searches page text and returns structured matches", async () => {
    await surfing.navigate(fixtureUrls["advanced-tools.html"]);

    const page = surfing.getPage();
    const results = await page.search("quarterly", 5);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      tag: "text",
      index: 1,
    });
    expect(results[0].text.toLowerCase()).toContain("quarterly report");
    expect(results[0].elementId).toBeUndefined();
  }, 15000);

  it("captures screenshots as PNG base64", async () => {
    await surfing.navigate(fixtureUrls["interactive.html"]);

    const page = surfing.getPage();
    const screenshot = await page.screenshot();
    const pngSignature = Buffer.from(screenshot, "base64").subarray(0, 8).toString("hex");

    expect(pngSignature).toBe("89504e470d0a1a0a");
  }, 15000);

  it("uploads files to file inputs", async () => {
    await surfing.navigate(fixtureUrls["advanced-tools.html"]);
    await surfing.getState();

    const tempDir = await mkdtemp(join(tmpdir(), "tidesurf-upload-"));
    const uploadPath = join(tempDir, "manifest.txt");

    try {
      await writeFile(uploadPath, "manifest");

      const page = surfing.getPage();
      await page.upload("I1", [uploadPath]);

      const uploadedName = await page.evaluate(
        "document.getElementById('file-output').textContent"
      );
      expect(uploadedName).toBe(basename(uploadPath));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }, 15000);

  it("downloads files to the requested directory", async () => {
    await surfing.navigate(fixtureUrls["advanced-tools.html"]);
    await surfing.getState();

    const downloadDir = await mkdtemp(join(tmpdir(), "tidesurf-download-"));

    try {
      const page = surfing.getPage();
      const result = await page.download("L1", { downloadDir, timeout: 15000 });

      expect(result.fileName).toBe("download.txt");
      const content = await readFile(result.filePath, "utf-8");
      expect(content).toBe("quarterly report");
    } finally {
      await rm(downloadDir, { recursive: true, force: true });
    }
  }, 20000);

  it("applies defaultViewport to newly launched sessions", async () => {
    const custom = await TideSurf.launch({
      headless: true,
      port: 9334,
      defaultViewport: { width: 640, height: 480 },
    });

    try {
      await custom.navigate(fixtureUrls["interactive.html"]);
      const viewport = await custom.getPage().evaluate(
        "({ width: window.innerWidth, height: window.innerHeight })"
      );
      expect(viewport).toEqual({ width: 640, height: 480 });
    } finally {
      await custom.close();
    }
  }, 20000);
});
