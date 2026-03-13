/**
 * Compression benchmarks — measures TideSurf's token efficiency
 * against raw source HTML and rendered DOM on realistic pages.
 *
 * Run: bun run test:bench
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { TideSurf } from "../../src/index.js";
import { estimateTokens } from "../../src/parser/token-budget.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "..", "fixtures");

let server: Server;
let serverPort: number;
let surfing: TideSurf;

interface BenchResult {
  page: string;
  sourceHtmlTokens: number;
  renderedDomTokens: number;
  tideSurfTokens: number;
  vsSourceRatio: string;
  vsRenderedRatio: string;
  vsSourceReduction: string;
  vsRenderedReduction: string;
  interactiveElements: number;
}

const results: BenchResult[] = [];

function countInteractiveIds(xml: string): number {
  const matches = xml.match(/id="[A-Z]\d+"/g);
  return matches ? matches.length : 0;
}

describe("Compression benchmarks", () => {
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
    surfing = await TideSurf.launch({ headless: true, port: 9555 });
  }, 30000);

  afterAll(async () => {
    await surfing?.close();
    server?.close();

    // Print results table
    console.log("\n");
    console.log("═".repeat(100));
    console.log("  TIDESURF COMPRESSION BENCHMARKS");
    console.log("═".repeat(100));
    console.log("");
    console.log(
      "  Page".padEnd(18) +
      "Source HTML".padEnd(14) +
      "Rendered DOM".padEnd(14) +
      "TideSurf".padEnd(14) +
      "vs Source".padEnd(14) +
      "vs Rendered".padEnd(14) +
      "IDs"
    );
    console.log("  " + "─".repeat(96));

    for (const r of results) {
      console.log(
        `  ${r.page.padEnd(16)}` +
        `${r.sourceHtmlTokens.toLocaleString().padStart(6)} tok`.padEnd(14) +
        `${r.renderedDomTokens.toLocaleString().padStart(6)} tok`.padEnd(14) +
        `${r.tideSurfTokens.toLocaleString().padStart(6)} tok`.padEnd(14) +
        `${r.vsSourceReduction.padStart(6)} (${r.vsSourceRatio}x)`.padEnd(14) +
        `${r.vsRenderedReduction.padStart(6)} (${r.vsRenderedRatio}x)`.padEnd(14) +
        `${r.interactiveElements}`
      );
    }

    console.log("");

    // Averages (only for realistic pages: ecommerce + news)
    const realistic = results.filter((r) => r.page === "ecommerce" || r.page === "news");
    if (realistic.length > 0) {
      const avgVsSource =
        realistic.reduce((sum, r) => sum + parseFloat(r.vsSourceRatio), 0) / realistic.length;
      const avgVsRendered =
        realistic.reduce((sum, r) => sum + parseFloat(r.vsRenderedRatio), 0) / realistic.length;
      const avgSourceReduction =
        realistic.reduce(
          (sum, r) => sum + (1 - r.tideSurfTokens / r.sourceHtmlTokens),
          0
        ) / realistic.length;
      const avgRenderedReduction =
        realistic.reduce(
          (sum, r) => sum + (1 - r.tideSurfTokens / r.renderedDomTokens),
          0
        ) / realistic.length;

      console.log(
        `  ${"AVG (realistic)".padEnd(16)}` +
        `${"".padEnd(14)}` +
        `${"".padEnd(14)}` +
        `${"".padEnd(14)}` +
        `${(avgSourceReduction * 100).toFixed(0)}% (${avgVsSource.toFixed(1)}x)`.padStart(6).padEnd(14) +
        `${(avgRenderedReduction * 100).toFixed(0)}% (${avgVsRendered.toFixed(1)}x)`.padStart(6).padEnd(14)
      );
    }
    console.log("═".repeat(100));
    console.log("");
  });

  const pages = [
    { name: "basic", file: "basic.html", desc: "Simple page (form + nav)" },
    { name: "interactive", file: "interactive.html", desc: "Interactive elements" },
    { name: "ecommerce", file: "bench-ecommerce.html", desc: "E-commerce (9 products)" },
    { name: "news", file: "bench-news.html", desc: "News site (articles + sidebar)" },
  ];

  for (const page of pages) {
    it(`${page.name}: compresses ${page.desc}`, async () => {
      // Navigate first
      await surfing.navigate(`http://localhost:${serverPort}/${page.file}`);

      // Get source HTML (what the server sent)
      const resp = await fetch(`http://localhost:${serverPort}/${page.file}`);
      const sourceHtml = await resp.text();
      const sourceHtmlTokens = estimateTokens(sourceHtml);

      // Get rendered DOM (what Chrome actually has — includes computed elements)
      const renderedDom = (await surfing
        .getPage()
        .evaluate("document.documentElement.outerHTML")) as string;
      const renderedDomTokens = estimateTokens(renderedDom);

      // Get TideSurf compressed state
      const state = await surfing.getState();
      const osTokens = estimateTokens(state.xml);
      const interactiveElements = countInteractiveIds(state.xml);

      results.push({
        page: page.name,
        sourceHtmlTokens,
        renderedDomTokens,
        tideSurfTokens: osTokens,
        vsSourceRatio: (sourceHtmlTokens / osTokens).toFixed(1),
        vsRenderedRatio: (renderedDomTokens / osTokens).toFixed(1),
        vsSourceReduction: `${((1 - osTokens / sourceHtmlTokens) * 100).toFixed(0)}%`,
        vsRenderedReduction: `${((1 - osTokens / renderedDomTokens) * 100).toFixed(0)}%`,
        interactiveElements,
      });

      // Assertions
      expect(sourceHtmlTokens / osTokens).toBeGreaterThan(1);
      expect(interactiveElements).toBeGreaterThan(0);

      // Verify no data/style/script noise leaked
      expect(state.xml).not.toContain("data-tracking");
      expect(state.xml).not.toContain("data-product-id");
      expect(state.xml).not.toContain("font-family");
      expect(state.xml).not.toContain("<script");
      expect(state.xml).not.toContain("<style");
      expect(state.xml).not.toContain("google");
    }, 15000);
  }

  it("token budget: ecommerce within 300 tokens", async () => {
    await surfing.navigate(`http://localhost:${serverPort}/bench-ecommerce.html`);

    const full = await surfing.getState();
    const budgeted = await surfing.getState({ maxTokens: 300 });

    const fullTokens = estimateTokens(full.xml);
    const budgetedTokens = estimateTokens(budgeted.xml);

    console.log(
      `\n  Token budget: ${fullTokens} tok → ${budgetedTokens} tok (budget: 300)`
    );

    expect(budgetedTokens).toBeLessThanOrEqual(350); // approximate
    expect(budgeted.xml).toContain("<page");
    expect(countInteractiveIds(budgeted.xml)).toBeGreaterThan(0);
    // Should have truncated indicator
    expect(budgeted.xml).toContain("truncated");
  }, 15000);

  it("speed: getState < 500ms average", async () => {
    await surfing.navigate(`http://localhost:${serverPort}/bench-ecommerce.html`);

    // Warm up
    await surfing.getState();

    const runs = 10;
    const times: number[] = [];

    for (let i = 0; i < runs; i++) {
      const start = performance.now();
      await surfing.getState();
      times.push(performance.now() - start);
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const p50 = [...times].sort((a, b) => a - b)[Math.floor(runs / 2)];
    const p99 = [...times].sort((a, b) => a - b)[Math.floor(runs * 0.99)];

    console.log(
      `\n  getState (${runs} runs): avg=${avg.toFixed(1)}ms, p50=${p50.toFixed(1)}ms, p99=${p99.toFixed(1)}ms`
    );

    expect(avg).toBeLessThan(500);
  }, 15000);
});
