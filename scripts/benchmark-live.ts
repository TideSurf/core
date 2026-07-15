#!/usr/bin/env bun
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

export const LIVE_BENCHMARK_THRESHOLDS = {
  rawTokens: 1_000,
  tideSurfTokens: 100,
  actionIds: 3,
} as const;

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
  if (rawTokens < LIVE_BENCHMARK_THRESHOLDS.rawTokens) {
    throw new RejectedSampleError(
      `rendered DOM is too small (${rawTokens} < ${LIVE_BENCHMARK_THRESHOLDS.rawTokens} tokens)`
    );
  }
  if (compressedTokens < LIVE_BENCHMARK_THRESHOLDS.tideSurfTokens) {
    throw new RejectedSampleError(
      `TideSurf output is too small (${compressedTokens} < ${LIVE_BENCHMARK_THRESHOLDS.tideSurfTokens} tokens)`
    );
  }
  if (interactive < LIVE_BENCHMARK_THRESHOLDS.actionIds) {
    throw new RejectedSampleError(
      `too few action IDs (${interactive} < ${LIVE_BENCHMARK_THRESHOLDS.actionIds})`
    );
  }
}

export function aggregateLiveResults(
  results: readonly Pick<Result, "rawTokens" | "tideSurfTokens" | "ms">[]
): {
  avgMs: number;
  totalRaw: number;
  totalCompressed: number;
  ratio: number;
  reduction: number;
} {
  if (results.length === 0) {
    throw new Error("Cannot aggregate an empty benchmark result set");
  }
  const totalRaw = results.reduce((sum, result) => sum + result.rawTokens, 0);
  const totalCompressed = results.reduce(
    (sum, result) => sum + result.tideSurfTokens,
    0
  );
  return {
    avgMs: results.reduce((sum, result) => sum + result.ms, 0) / results.length,
    totalRaw,
    totalCompressed,
    ratio: totalRaw / totalCompressed,
    reduction: (1 - totalCompressed / totalRaw) * 100,
  };
}

async function main(): Promise<void> {
  console.log("Launching browser...\n");
  const surf = await TideSurf.launch({ headless: true });
  const results: Result[] = [];
  const failures: string[] = [];

  try {
    for (const site of SITES) {
      process.stdout.write(`  ${site.name.padEnd(18)} `);
      try {
        await surf.navigate(site.url);

        const rawHtml = await surf.getPage().evaluate("document.documentElement.outerHTML") as string;
        const rawTokens = estimateTokens(rawHtml);

        // Use full-page visible state so both sides cover the same rendered page.
        const start = performance.now();
        const state = await surf.readPage({ viewport: false });
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
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        if (error instanceof RejectedSampleError) {
          console.log(`SKIPPED: ${detail}`);
        } else {
          failures.push(`${site.name}: ${detail}`);
          console.log(`FAILED: ${detail}`);
        }
      }
    }
  } finally {
    await surf.close();
  }

  const {
    avgMs,
    totalRaw,
    totalCompressed,
    ratio: aggregateRatio,
    reduction: aggregateReduction,
  } = aggregateLiveResults(results);

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

  if (failures.length > 0) {
    throw new Error(`Live benchmark failures:\n${failures.join("\n")}`);
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
