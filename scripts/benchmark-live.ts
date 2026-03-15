#!/usr/bin/env bun
/**
 * Live-site token benchmark — compares raw HTML vs TideSurf compressed output
 * on real-world pages to demonstrate compression ratios.
 *
 * Usage: bun scripts/benchmark-live.ts
 */

import { TideSurf } from "../src/index.js";
import { estimateTokens } from "../src/parser/token-budget.js";

const SITES = [
  { name: "Wikipedia",       url: "https://en.wikipedia.org/wiki/Web_browser" },
  { name: "Hacker News",     url: "https://news.ycombinator.com" },
  { name: "GitHub",          url: "https://github.com/anthropics/claude-code" },
  { name: "MDN Docs",        url: "https://developer.mozilla.org/en-US/docs/Web/HTML" },
  { name: "Amazon",          url: "https://www.amazon.com/dp/B0D77ZRG7W" },
  { name: "Reddit",          url: "https://old.reddit.com/r/programming" },
  { name: "Stack Overflow",  url: "https://stackoverflow.com/questions/tagged/javascript" },
  { name: "NPM",             url: "https://www.npmjs.com/package/react" },
];

interface Result {
  name: string;
  url: string;
  rawTokens: number;
  tideSurfTokens: number;
  ratio: number;
  reduction: number;
  interactive: number;
  ms: number;
}

async function main() {
  console.log("Launching browser...\n");
  const surf = await TideSurf.launch({ headless: true });

  const results: Result[] = [];

  for (const site of SITES) {
    process.stdout.write(`  ${site.name.padEnd(18)} `);
    try {
      await surf.navigate(site.url);

      // Get rendered DOM token count
      const rawHtml = await surf.getPage().evaluate("document.documentElement.outerHTML") as string;
      const rawTokens = estimateTokens(rawHtml);

      // Get TideSurf compressed state
      const start = performance.now();
      const state = await surf.getState();
      const ms = performance.now() - start;
      const tideSurfTokens = estimateTokens(state.content);

      const interactive = (state.content.match(/\b[LBISTFD]\d+\b/g) || []).length;
      const ratio = rawTokens / tideSurfTokens;
      const reduction = (1 - tideSurfTokens / rawTokens) * 100;

      results.push({ name: site.name, url: site.url, rawTokens, tideSurfTokens, ratio, reduction, interactive, ms });

      console.log(
        `${rawTokens.toLocaleString().padStart(8)} → ${tideSurfTokens.toLocaleString().padStart(6)} tok` +
        `  (${reduction.toFixed(0)}%, ${ratio.toFixed(1)}x)` +
        `  ${interactive} IDs  ${ms.toFixed(0)}ms`
      );
    } catch (err) {
      console.log(`FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  await surf.close();

  // Summary
  if (results.length === 0) return;

  const avgRatio = results.reduce((s, r) => s + r.ratio, 0) / results.length;
  const avgReduction = results.reduce((s, r) => s + r.reduction, 0) / results.length;
  const avgMs = results.reduce((s, r) => s + r.ms, 0) / results.length;
  const totalRaw = results.reduce((s, r) => s + r.rawTokens, 0);
  const totalCompressed = results.reduce((s, r) => s + r.tideSurfTokens, 0);

  console.log("\n" + "═".repeat(80));
  console.log("  TIDESURF LIVE BENCHMARK");
  console.log("═".repeat(80));
  console.log("");
  console.log(
    "  Site".padEnd(20) +
    "Raw HTML".padStart(10) +
    "TideSurf".padStart(10) +
    "Reduction".padStart(11) +
    "Ratio".padStart(8) +
    "IDs".padStart(6) +
    "Time".padStart(8)
  );
  console.log("  " + "─".repeat(76));

  for (const r of results) {
    console.log(
      `  ${r.name.padEnd(18)}` +
      `${r.rawTokens.toLocaleString().padStart(10)}` +
      `${r.tideSurfTokens.toLocaleString().padStart(10)}` +
      `${r.reduction.toFixed(0)}%`.padStart(11) +
      `${r.ratio.toFixed(1)}x`.padStart(8) +
      `${r.interactive}`.padStart(6) +
      `${r.ms.toFixed(0)}ms`.padStart(8)
    );
  }

  console.log("  " + "─".repeat(76));
  console.log(
    `  ${"AVERAGE".padEnd(18)}` +
    `${(totalRaw / results.length).toLocaleString().padStart(10)}` +
    `${(totalCompressed / results.length).toLocaleString().padStart(10)}` +
    `${avgReduction.toFixed(0)}%`.padStart(11) +
    `${avgRatio.toFixed(1)}x`.padStart(8) +
    `${""}`.padStart(6) +
    `${avgMs.toFixed(0)}ms`.padStart(8)
  );
  console.log("═".repeat(80));

  // Markdown output for README
  console.log("\n\n--- MARKDOWN (for README) ---\n");
  console.log("| Site | Raw HTML | TideSurf | Reduction | Ratio |");
  console.log("|------|----------|----------|-----------|-------|");
  for (const r of results) {
    console.log(
      `| ${r.name} | ${r.rawTokens.toLocaleString()} tokens | ${r.tideSurfTokens.toLocaleString()} tokens | ${r.reduction.toFixed(0)}% | **${r.ratio.toFixed(0)}x** |`
    );
  }
  console.log(
    `| **Average** | | | **${avgReduction.toFixed(0)}%** | **${avgRatio.toFixed(0)}x** |`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
