import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import { TideSurf } from "../../src/index.js";
import { getTideSurfConnectionInfo } from "../../src/tidesurf.js";
import { ElementNotFoundError } from "../../src/errors.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "..", "fixtures");

let surfing: TideSurf;
let fixtureUrls: Record<string, string> = {};
let fixtureServer: Server | null = null;

async function canLaunchBrowser(): Promise<boolean> {
  let browser: TideSurf | null = null;
  try {
    browser = await TideSurf.launch({ headless: true });
    return true;
  } catch (error) {
    if (process.env["CHROME_PATH"]) throw error;
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
      "visibility.html",
    ] as const;
    const fixtureSet = new Set<string>(fixtureNames);

    fixtureServer = createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        const name = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
        if (!fixtureSet.has(name as typeof fixtureNames[number])) {
          res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
          res.end("Not found");
          return;
        }
        const html = await readFile(join(fixturesDir, name), "utf-8");
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(html);
      } catch (err) {
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        res.end(err instanceof Error ? err.message : String(err));
      }
    });
    await new Promise<void>((resolve) => {
      fixtureServer!.listen(0, "127.0.0.1", resolve);
    });
    const address = fixtureServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Fixture server did not bind to a TCP port");
    }

    fixtureUrls = Object.fromEntries(
      fixtureNames.map((name) => [name, `http://127.0.0.1:${address.port}/${name}`] as const)
    );

    surfing = await TideSurf.launch({ headless: true, allowLocalhost: true });
  }, 60000);

  afterAll(async () => {
    await surfing?.close();
    await new Promise<void>((resolve, reject) => {
      if (!fixtureServer) {
        resolve();
        return;
      }
      fixtureServer.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("navigates and gets page state", async () => {
    await surfing.navigate(fixtureUrls["basic.html"]);
    const state = await surfing.getState();

    expect(state.url).toContain("basic.html");
    expect(state.title).toBe("Test Page");
    expect(state.content).toContain("# ");
    expect(state.content).toContain(">");

    // Interactive elements retain IDs.
    expect(state.content).toContain("L1");
    expect(state.content).toContain("B1");
    expect(state.content).toContain("I1");

    // Scripts are excluded.
    expect(state.content).not.toContain("alert");
    expect(state.content).not.toContain("<script");

    // ARIA-hidden content is excluded.
    expect(state.content).not.toContain("Hidden content");
  }, 15000);

  it("uses includeHidden as a full-DOM debugging override", async () => {
    await surfing.navigate(fixtureUrls["basic.html"]);
    const normal = await surfing.getState({ viewport: false });
    expect(normal.content).not.toContain("Hidden content");
    expect(normal.content).not.toContain("Computed hidden");
    expect(normal.content).not.toContain("Inline hidden");
    expect(normal.content).not.toContain("HTML hidden");

    const debugging = await surfing.getState({ includeHidden: true });
    expect(debugging.content).toContain("Hidden content");
    expect(debugging.content).toContain("Computed hidden");
    expect(debugging.content).toContain("Inline hidden");
    expect(debugging.content).toContain("HTML hidden");
  }, 15000);

  it("clicks a button", async () => {
    await surfing.navigate(fixtureUrls["interactive.html"]);
    const state = await surfing.getState();

    expect(state.content).toContain("[B1]");

    const page = surfing.getPage();
    await page.click("B1");

    const result = await page.evaluate(
      "document.getElementById('output').textContent"
    );
    expect(result).toBe("clicked!");
  }, 15000);

  it("completes a click that navigates away from its remote object", async () => {
    await surfing.navigate(fixtureUrls["basic.html"]);
    const page = surfing.getPage();
    await page.evaluate(`document.body.innerHTML =
      '<a href="${fixtureUrls["interactive.html"]}">Next page</a>'`);
    await surfing.getState();

    await expect(page.click("L1")).resolves.toBeUndefined();
    await page.waitForStable(5_000);

    expect(await page.evaluate("location.pathname")).toBe("/interactive.html");
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
    expect(result.data as string).toContain("# ");
  }, 15000);

  it("search returns nearest interactive element IDs", async () => {
    await surfing.navigate(fixtureUrls["interactive.html"]);
    await surfing.getState();

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
    expect(shadowState.content).toContain("Shadow Button");

    await surfing.navigate(fixtureUrls["iframe-parent.html"]);
    const iframeState = await surfing.getState({ viewport: true });
    expect(iframeState.content).toContain("Child Link");
  }, 15000);

  it("handles nested visibility, clipped frames, and transient markers", async () => {
    await surfing.navigate(fixtureUrls["visibility.html"]);
    const staleMarker = "data-tidesurf-0123456789abcdef0123456789abcdef-visible";
    await surfing.getPage().evaluate(`(() => {
      const element = document.getElementById('site-marker');
      element.setAttribute(${JSON.stringify(staleMarker)}, '1');
      const style = document.createElement('style');
      style.textContent = '#site-marker[${staleMarker}] { display: none !important; }';
      document.head.append(style);
    })()`);

    const first = await surfing.getState();
    const second = await surfing.getState();
    expect(first.content).toContain("VISIBLE CHILD");
    expect(first.content).toContain("SITE MARKER");
    expect(second.content).toContain("VISIBLE CHILD");
    expect(second.content).not.toMatch(/\[B\d+\] CLIPPED FRAME CHILD/);
    expect(second.content).not.toMatch(/\[B\d+\] OFFSCREEN FRAME CHILD/);

    const attributes = await surfing.getPage().evaluate(`(() => {
      const element = document.getElementById('site-marker');
      return {
        ...Object.fromEntries(['data-os-visible','data-os-hidden','data-os-state']
          .map(name => [name, element.getAttribute(name)])),
        stale: element.getAttribute(${JSON.stringify(staleMarker)}),
        parserMarkers: Array.from(element.attributes)
          .map(attribute => attribute.name)
          .filter(name => /^data-tidesurf-[0-9a-f]{32}-(?:visible|hidden|state|text)$/.test(name))
      };
    })()`);
    expect(attributes).toEqual({
      "data-os-visible": "site-value",
      "data-os-hidden": "site-hidden",
      "data-os-state": "site-state",
      stale: null,
      parserMarkers: [],
    });

    const fullPage = await surfing.getState({ viewport: false });
    expect(fullPage.content).toContain("OFFSCREEN FRAME CHILD");
  }, 15000);

  it("keeps collapsed viewport text scoped to its computed wrapper", async () => {
    await surfing.navigate(fixtureUrls["basic.html"]);
    await surfing.getPage().evaluate(`(() => {
      document.body.innerHTML = \`
        <main style="height: 6000px">
          <div>COLLAPSED ONSCREEN</div>
          <div style="display: contents">DISPLAY CONTENTS ONSCREEN</div>
          <div style="position: absolute; top: 0; left: 300px; height: 6000px">
            DIRECT TEXT ONSCREEN
            <span style="display: block; height: 5000px"></span>
            DIRECT TEXT OFFSCREEN
          </div>
          <div id="shadow-direct-text" style="position: absolute; top: 0; left: 600px; height: 6000px"></div>
          <div style="display: none; display: block">OVERRIDDEN DISPLAY VISIBLE</div>
          <div style="visibility: hidden; visibility: visible">OVERRIDDEN VISIBILITY VISIBLE</div>
          <div style="--display: none">CUSTOM PROPERTY VISIBLE</div>
          <div style="height: 100px; overflow: hidden">
            <button style="margin-top: 300px">OVERFLOW CLIPPED BUTTON</button>
          </div>
          <div style="position: relative; width: 100px; height: 100px; overflow-x: hidden">
            <button style="position: absolute; left: 300px">X AXIS CLIPPED BUTTON</button>
          </div>
          <div style="position: relative; height: 100px; clip-path: inset(0 0 90% 0)">
            <button style="position: absolute; top: 40px">CLIP PATH CLIPPED BUTTON</button>
          </div>
          <div style="position: absolute; top: 200px; left: 0; width: 100px; height: 100px; clip-path: circle(10px at 10px 10px)">
            <button style="position: absolute; top: 70px; left: 70px">CIRCLE CLIPPED BUTTON</button>
          </div>
          <div style="position: absolute; top: 200px; left: 180px; width: 100px; height: 100px; clip-path: circle(30px at 30px 30px)">
            <button style="position: absolute; top: 20px; left: 45px">PARTIAL CIRCLE BUTTON</button>
          </div>
          <div style="margin-top: 5000px">OFFSCREEN COLLAPSED SENTINEL</div>
        </main>
      \`;
      const shadow = document.getElementById('shadow-direct-text').attachShadow({ mode: 'open' });
      shadow.append('SHADOW DIRECT ONSCREEN');
      const spacer = document.createElement('div');
      spacer.style.height = '5000px';
      shadow.append(spacer, 'SHADOW DIRECT OFFSCREEN');
      window.scrollTo(0, 0);
    })()`);

    const viewport = await surfing.getState();
    expect(viewport.content).toContain("COLLAPSED ONSCREEN");
    expect(viewport.content).toContain("DISPLAY CONTENTS ONSCREEN");
    expect(viewport.content).toContain("DIRECT TEXT ONSCREEN");
    expect(viewport.content).toContain("SHADOW DIRECT ONSCREEN");
    expect(viewport.content).toContain("OVERRIDDEN DISPLAY VISIBLE");
    expect(viewport.content).toContain("OVERRIDDEN VISIBILITY VISIBLE");
    expect(viewport.content).toContain("CUSTOM PROPERTY VISIBLE");
    expect(viewport.content).not.toContain("OVERFLOW CLIPPED BUTTON");
    expect(viewport.content).not.toContain("X AXIS CLIPPED BUTTON");
    expect(viewport.content).not.toContain("CLIP PATH CLIPPED BUTTON");
    expect(viewport.content).not.toContain("CIRCLE CLIPPED BUTTON");
    expect(viewport.content).toContain("PARTIAL CIRCLE BUTTON");
    expect(viewport.content).not.toContain("DIRECT TEXT OFFSCREEN");
    expect(viewport.content).not.toContain("SHADOW DIRECT OFFSCREEN");
    expect(viewport.content).not.toContain("OFFSCREEN COLLAPSED SENTINEL");

    const fullPage = await surfing.getState({ viewport: false });
    expect(fullPage.content).toContain("OVERFLOW CLIPPED BUTTON");
    expect(fullPage.content).toContain("X AXIS CLIPPED BUTTON");
    expect(fullPage.content).toContain("CLIP PATH CLIPPED BUTTON");
    expect(fullPage.content).toContain("CIRCLE CLIPPED BUTTON");
    expect(fullPage.content).toContain("DIRECT TEXT OFFSCREEN");
    expect(fullPage.content).toContain("SHADOW DIRECT OFFSCREEN");
    expect(fullPage.content).toContain("OFFSCREEN COLLAPSED SENTINEL");
  }, 15000);

  it("reuses ancestor clip geometry and skips hidden subtree styles", async () => {
    await surfing.navigate(fixtureUrls["basic.html"]);
    await surfing.getPage().evaluate(`(() => {
      document.body.innerHTML = '';

      const clipped = document.createElement('main');
      clipped.style.cssText = 'height: 240px; overflow: hidden';
      for (let index = 0; index < 200; index++) {
        const button = document.createElement('button');
        button.style.cssText = 'display: block; height: 20px';
        button.textContent = 'VISIBLE ACTION ' + index;
        clipped.append(button);
      }
      const nativeBounds = clipped.getBoundingClientRect.bind(clipped);
      globalThis.__clipBoundsCalls = 0;
      clipped.getBoundingClientRect = () => {
        globalThis.__clipBoundsCalls++;
        return nativeBounds();
      };

      const hidden = document.createElement('section');
      hidden.style.display = 'none';
      for (let index = 0; index < 200; index++) {
        const button = document.createElement('button');
        button.className = 'hidden-style-probe';
        button.textContent = 'HIDDEN ACTION ' + index;
        hidden.append(button);
      }

      const nativeComputedStyle = window.getComputedStyle.bind(window);
      globalThis.__hiddenStyleCalls = 0;
      globalThis.__nativeComputedStyle = window.getComputedStyle;
      window.getComputedStyle = (element, pseudo) => {
        if (element.classList && element.classList.contains('hidden-style-probe')) {
          globalThis.__hiddenStyleCalls++;
        }
        return nativeComputedStyle(element, pseudo);
      };

      document.body.append(clipped, hidden);
    })()`);

    let state: Awaited<ReturnType<typeof surfing.getState>> | undefined;
    let metrics!: { clipBoundsCalls: number; hiddenStyleCalls: number };
    try {
      state = await surfing.getState();
    } finally {
      metrics = await surfing.getPage().evaluate(`(() => {
        window.getComputedStyle = globalThis.__nativeComputedStyle;
        const result = {
          clipBoundsCalls: globalThis.__clipBoundsCalls,
          hiddenStyleCalls: globalThis.__hiddenStyleCalls
        };
        delete globalThis.__clipBoundsCalls;
        delete globalThis.__hiddenStyleCalls;
        delete globalThis.__nativeComputedStyle;
        return result;
      })()`) as { clipBoundsCalls: number; hiddenStyleCalls: number };
    }

    expect(state!.content).toContain("VISIBLE ACTION 0");
    expect(state!.content).not.toContain("HIDDEN ACTION");
    expect(metrics.clipBoundsCalls).toBeLessThanOrEqual(3);
    expect(metrics.hiddenStyleCalls).toBe(0);
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

    expect(state.content).not.toContain("B1");
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

  it("keeps implicit downloads inside explicit filesystem policy", async () => {
    const allowedRoot = await mkdtemp(
      join(process.cwd(), ".tidesurf-download-policy-")
    );
    const restricted = await TideSurf.launch({
      headless: true,
      allowLocalhost: true,
      fileAccessRoots: [allowedRoot],
    });

    try {
      await restricted.navigate(fixtureUrls["advanced-tools.html"]);
      await restricted.getState();
      const result = await restricted.getPage().download("L1", {
        timeout: 15000,
      });
      const pathFromRoot = relative(allowedRoot, result.filePath);

      expect(pathFromRoot).not.toStartWith("..");
      expect(pathFromRoot).not.toBe("");
      expect(await readFile(result.filePath, "utf-8")).toBe("quarterly report");
    } finally {
      await restricted.close();
      await rm(allowedRoot, { recursive: true, force: true });
    }
  }, 25000);

  it("applies defaultViewport to newly launched sessions", async () => {
    const custom = await TideSurf.launch({
      headless: true,
      defaultViewport: { width: 640, height: 480 },
      allowLocalhost: true,
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

  it("launches parallel managed browsers on distinct ephemeral ports", async () => {
    const instances: TideSurf[] = [];
    const launch = async () => {
      const browser = await TideSurf.launch({ headless: true });
      instances.push(browser);
      return browser;
    };

    try {
      const [first, second] = await Promise.all([launch(), launch()]);
      const firstEndpoint = getTideSurfConnectionInfo(first)!;
      const secondEndpoint = getTideSurfConnectionInfo(second)!;
      expect(firstEndpoint.port).toBeGreaterThan(0);
      expect(secondEndpoint.port).toBeGreaterThan(0);
      expect(firstEndpoint.port).not.toBe(secondEndpoint.port);
    } finally {
      await Promise.all(instances.map((browser) => browser.close()));
    }
  }, 30000);

  it("disconnects an attached client without stopping the user browser", async () => {
    await surfing.navigate(fixtureUrls["basic.html"]);
    const endpoint = getTideSurfConnectionInfo(surfing)!;
    const attached = await TideSurf.connect({
      host: endpoint.host,
      port: endpoint.port,
      allowLocalhost: true,
    });

    expect((await attached.getState()).title).toBe("Test Page");
    await attached.close();

    expect(await surfing.listTabs()).not.toHaveLength(0);
    expect((await surfing.getState()).title).toBe("Test Page");
  }, 20000);

  it("rejects an explicit managed port collision", async () => {
    const address = fixtureServer?.address();
    if (!address || typeof address === "string") {
      throw new Error("Fixture server has no TCP port");
    }

    await expect(
      TideSurf.launch({ headless: true, port: address.port, timeout: 2_000 })
    ).rejects.toThrow(`Port ${address.port} is already in use`);
  }, 10000);
});
