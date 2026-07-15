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

const INTERSTITIAL_TEXT = [
  /access denied/i,
  /are you a robot/i,
  /captcha/i,
  /checking your browser/i,
  /enable javascript and cookies/i,
  /human verification/i,
  /just a moment/i,
  /request (?:was )?blocked/i,
  /robot check/i,
  /verify (?:that )?you are human/i,
];

const MIN_RAW_TOKENS = 1_000;
const MIN_COMPRESSED_TOKENS = 100;
const MIN_ACTION_IDS = 3;

class RejectedSampleError extends Error {}

function rejectInvalidSample(
  title: string,
  content: string,
  rawTokens: number,
  compressedTokens: number,
  interactive: number
): void {
  const sample = `${title}\n${content.slice(0, 2_000)}`;
  if (INTERSTITIAL_TEXT.some((pattern) => pattern.test(sample))) {
    throw new RejectedSampleError("interstitial or bot challenge detected");
  }
  if (rawTokens < MIN_RAW_TOKENS) {
    throw new RejectedSampleError(
      `rendered DOM is too small (${rawTokens} < ${MIN_RAW_TOKENS} tokens)`
    );
  }
  if (compressedTokens < MIN_COMPRESSED_TOKENS) {
    throw new RejectedSampleError(
      `TideSurf output is too small (${compressedTokens} < ${MIN_COMPRESSED_TOKENS} tokens)`
    );
  }
  if (interactive < MIN_ACTION_IDS) {
    throw new RejectedSampleError(
      `too few action IDs (${interactive} < ${MIN_ACTION_IDS})`
    );
  }
}

async function main() {
  console.log("Launching browser...\n");
  const surf = await TideSurf.launch({ headless: true });

  const results: Result[] = [];

  for (const site of SITES) {
    process.stdout.write(`  ${site.name.padEnd(18)} `);
    try {
      await surf.navigate(site.url);

      const rawHtml = await surf.getPage().evaluate("document.documentElement.outerHTML") as string;
      const rawTokens = estimateTokens(rawHtml);

      // Compare the complete rendered page with complete TideSurf state. The
      // production default is viewport-filtered, which is not a fair full-DOM
      // compression denominator.
      const start = performance.now();
      const state = await surf.getState({ viewport: false });
      const ms = performance.now() - start;
      const tideSurfTokens = estimateTokens(state.content);

      const interactive = state.nodeMap.size;
      rejectInvalidSample(
        state.title,
        state.content,
        rawTokens,
        tideSurfTokens,
        interactive
      );
      const ratio = rawTokens / tideSurfTokens;
      const reduction = (1 - tideSurfTokens / rawTokens) * 100;

      results.push({ name: site.name, url: site.url, rawTokens, tideSurfTokens, ratio, reduction, interactive, ms });

      console.log(
        `${rawTokens.toLocaleString().padStart(8)} → ${tideSurfTokens.toLocaleString().padStart(6)} tok` +
        `  (${reduction.toFixed(0)}%, ${ratio.toFixed(1)}x)` +
        `  ${interactive} IDs  ${ms.toFixed(0)}ms`
      );
    } catch (err) {
      const label = err instanceof RejectedSampleError ? "SKIPPED" : "FAILED";
      console.log(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  await surf.close();

  if (results.length === 0) return;

  const avgMs = results.reduce((s, r) => s + r.ms, 0) / results.length;
  const totalRaw = results.reduce((s, r) => s + r.rawTokens, 0);
  const totalCompressed = results.reduce((s, r) => s + r.tideSurfTokens, 0);
  const aggregateRatio = totalRaw / totalCompressed;
  const aggregateReduction = (1 - totalCompressed / totalRaw) * 100;

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
    `  ${"TOTAL / AGGREGATE".padEnd(18)}` +
    `${totalRaw.toLocaleString().padStart(10)}` +
    `${totalCompressed.toLocaleString().padStart(10)}` +
    `${aggregateReduction.toFixed(0)}%`.padStart(11) +
    `${aggregateRatio.toFixed(1)}x`.padStart(8) +
    `${""}`.padStart(6) +
    `${avgMs.toFixed(0)}ms`.padStart(8)
  );
  console.log("═".repeat(80));

  console.log("\n\n--- MARKDOWN (for README) ---\n");
  console.log("| Site | Raw HTML | TideSurf | Reduction | Ratio |");
  console.log("|------|----------|----------|-----------|-------|");
  for (const r of results) {
    console.log(
      `| ${r.name} | ${r.rawTokens.toLocaleString()} tokens | ${r.tideSurfTokens.toLocaleString()} tokens | ${r.reduction.toFixed(0)}% | **${r.ratio.toFixed(0)}x** |`
    );
  }
  console.log(
    `| **Total / aggregate** | ${totalRaw.toLocaleString()} tokens | ${totalCompressed.toLocaleString()} tokens | **${aggregateReduction.toFixed(0)}%** | **${aggregateRatio.toFixed(1)}x** |`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
