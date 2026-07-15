#!/usr/bin/env bun

import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { generalHelp } from "../src/cli/help.js";
import { TOOL_REGISTRY } from "../src/tools/registry.js";

const root = resolve(import.meta.dir, "..");
const failures: string[] = [];

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

function equal(actual: unknown, expected: unknown, message: string): void {
  check(JSON.stringify(actual) === JSON.stringify(expected), message);
}

function markdownSection(source: string, heading: string): string {
  const marker = `${heading}\n`;
  const start = source.indexOf(marker);
  if (start < 0) return "";
  const bodyStart = start + marker.length;
  const next = source.slice(bodyStart).search(/^## /m);
  return source.slice(start, next < 0 ? undefined : bodyStart + next).trimEnd();
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function markdownLinks(source: string): string[] {
  const prose = source
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`\n]*`/g, "");
  return [...prose.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)].map((match) => match[1]);
}

const toolCount = 18;
check(TOOL_REGISTRY.length === toolCount, `expected ${toolCount} canonical tools`);

const llms = read("llms.txt");
const publicLlms = read("website/landing/public/llms.txt");
equal(publicLlms, llms, "website llms.txt must be byte-identical to package llms.txt");

const llmsTools = [...markdownSection(llms, "Direct tool commands, in registry order:").matchAll(
  /^(\d+)\. `([^`]+)`(?: \(`([^`]+)`\))?$/gm
)].map((match) => ({
  index: Number(match[1]),
  command: match[2],
  alias: match[3],
}));
equal(
  llmsTools,
  TOOL_REGISTRY.map((tool, index) => ({
    index: index + 1,
    command: tool.cli.command,
    alias: tool.cli.aliases[0],
  })),
  "llms.txt direct tool list must match registry order and aliases"
);

const api = read("website/docs/content/api-reference.md");
const apiRows = [...markdownSection(api, "## Canonical tools").matchAll(
  /^\| `([^`]+)` \| ([^|]+?) \| `([^`]+)` \| (yes|no) \|$/gm
)].map((match) => ({
  name: match[1],
  inputs: match[2] === "none"
    ? []
    : [...match[2].matchAll(/`([^`]+)`/g)].map((input) => input[1]),
  command: match[3],
  readOnly: match[4] === "yes",
}));
equal(
  apiRows,
  TOOL_REGISTRY.map((tool) => {
    const required = new Set(tool.inputSchema.required ?? []);
    return {
      name: tool.name,
      inputs: Object.keys(tool.inputSchema.properties).map((name) =>
        required.has(name) ? name : `${name}?`
      ),
      command: tool.cli.command,
      readOnly: tool.readOnlyAllowed,
    };
  }),
  "API canonical-tool table must match the registry"
);

const cliDocs = read("website/docs/content/cli.md");
const cliRows = [...markdownSection(cliDocs, "## Direct tool commands").matchAll(
  /^\| `([^`]+)`(?: \/ `([^`]+)`)? \|/gm
)].map((match) => ({
  command: match[1].split(/\s/, 1)[0],
  alias: match[2]?.split(/\s/, 1)[0],
}));
equal(
  cliRows,
  TOOL_REGISTRY.map((tool) => ({
    command: tool.cli.command,
    alias: tool.cli.aliases[0],
  })),
  "CLI direct-command table must match registry commands and aliases"
);

for (const readmePath of ["README.md", "README.ja.md", "README.ko.md"]) {
  const firstTextFence = read(readmePath).match(/```text\n([\s\S]*?)```/)?.[1] ?? "";
  equal(
    firstTextFence.trim().split(/\s+/),
    TOOL_REGISTRY.map((tool) => tool.cli.command),
    `${readmePath} direct-command block must match the registry`
  );
}

const expectedReadOnlyNames = TOOL_REGISTRY
  .filter((tool) => tool.readOnlyAllowed)
  .map((tool) => tool.name);
const llmsReadOnly = llms.match(/^Allowed tools: (.+)$/m)?.[1] ?? "";
equal(
  [...llmsReadOnly.matchAll(/`([^`]+)`/g)].map((match) => match[1]),
  expectedReadOnlyNames,
  "llms.txt read-only list must match the registry"
);
const security = read("website/docs/content/security.md");
const securityAllowed = security
  .slice(security.indexOf("allows six observation tools:"), security.indexOf("It rejects:"))
  .match(/^- `([^`]+)`$/gm)
  ?.map((line) => line.slice(3, -1)) ?? [];
equal(securityAllowed, expectedReadOnlyNames, "security read-only list must match the registry");
for (const path of [
  "README.md",
  "README.ja.md",
  "README.ko.md",
  "llms.txt",
  "website/docs/content/api-reference.md",
  "website/docs/content/security.md",
]) {
  check(
    read(path).includes("fileAccessRoots: []"),
    `${path} must document that an empty SDK fileAccessRoots array disables file access`
  );
}

for (const option of [...generalHelp().matchAll(/^  (--[a-z][a-z-]*)/gm)].map((match) => match[1])) {
  check(cliDocs.includes(option), `CLI docs must include global option ${option}`);
}

const cliSource = read("src/cli-program.ts");
const exitCodes = Object.fromEntries(
  [...cliSource.matchAll(/^const EXIT_([A-Z]+) = (\d+);$/gm)].map((match) => [
    match[1].toLowerCase(),
    Number(match[2]),
  ])
);
equal(exitCodes, { usage: 2, browser: 3, tool: 4, protocol: 5 }, "CLI exit-code constants changed");
for (const code of Object.values(exitCodes)) {
  check(cliDocs.includes(`| \`${code}\` |`), `CLI docs must include exit code ${code}`);
  check(llms.includes(`${code} `), `llms.txt must include exit code ${code}`);
}

const typesSource = read("src/types.ts");
function interfaceOptions(name: string): string[] {
  const body = typesSource.match(new RegExp(`export interface ${name} \\{([\\s\\S]*?)^\\}`, "m"))?.[1] ?? "";
  return [...body.matchAll(/^\s{2}(\w+)\?:/gm)].map((match) => match[1]);
}
function optionTable(sectionStart: string, sectionEnd: string): string[] {
  const start = api.indexOf(sectionStart);
  const end = api.indexOf(sectionEnd, start + sectionStart.length);
  return [...api.slice(start, end < 0 ? undefined : end).matchAll(/^\| `([^`]+)` \|/gm)]
    .map((match) => match[1]);
}
equal(
  optionTable("### `TideSurf.launch(options?)`", "### `TideSurf.connect(options?)`").sort(),
  interfaceOptions("TideSurfOptions").sort(),
  "API launch option table must match TideSurfOptions"
);
equal(
  optionTable("### `TideSurf.connect(options?)`", "### `close()`").sort(),
  interfaceOptions("TideSurfConnectOptions").sort(),
  "API connect option table must match TideSurfConnectOptions"
);

const docsIndex = read("website/docs/index.html");
const contentNames = readdirSync(resolve(root, "website/docs/content"))
  .filter((name) => name.endsWith(".md"))
  .map((name) => name.slice(0, -3))
  .sort();
const sidebarPages = [...docsIndex.matchAll(/class="sidebar-link" data-page="([^"]+)"/g)]
  .map((match) => match[1])
  .sort();
equal(sidebarPages, contentNames, "every docs content file must appear once in sidebar navigation");
equal([...new Set(sidebarPages)], sidebarPages, "docs sidebar page entries must be unique");

const docsMain = read("website/docs/src/main.ts");
for (const key of [...docsIndex.matchAll(/data-i18n(?:-placeholder)?="([^"]+)"/g)].map((match) => match[1])) {
  check(docsMain.includes(`"${key}"`), `missing docs translation key: ${key}`);
}

const expectedPageHeader = "> example.com/search | 0/1200 800vh";
for (const path of [
  "README.md",
  "README.ja.md",
  "README.ko.md",
  "llms.txt",
  "website/docs/content/getting-started.md",
  "website/docs/content/page-format.md",
]) {
  check(read(path).includes(expectedPageHeader), `${path} must use the current page-header example`);
}
check(
  read("website/landing/index.html").includes("&gt; example.com/search | 0/1200 800vh"),
  "landing specimen must use the current page-header example"
);

const terminologyPaths = [
  "README.md",
  "README.ja.md",
  "README.ko.md",
  "llms.txt",
  "AGENTS.md",
  "website/PRODUCT.md",
  "website/DESIGN.md",
  "website/docs/index.html",
  "website/landing/index.html",
  "website/landing/public/og.html",
  "website/landing/public/og.svg",
  "src/tools/registry.ts",
  ...contentNames
    .filter((name) => name !== "changelog")
    .map((name) => `website/docs/content/${name}.md`),
];
const staleIdClaim = /\bstable\s+(?:(?:browser|action|element)\s+)?(?:ids|handles)\b/i;
for (const path of terminologyPaths) {
  check(!staleIdClaim.test(read(path)), `${path} must not claim snapshot-scoped IDs are stable`);
}
check(
  !/evaluate[^.\n]*through[^.\n]*(?:IDs|handles)/i.test(read("website/landing/index.html")),
  "landing must not claim evaluate uses an action ID"
);

const benchmarkDocs = read("website/docs/content/benchmarks.md");
const landing = read("website/landing/index.html");
const compressionExpectations = JSON.parse(
  read("test/fixtures/compression-expectations.json")
) as {
  schemaVersion: number;
  fixtures: Array<{
    name: string;
    label: string;
    sourceHtmlTokens: number;
    renderedDomTokens: number;
    tideSurfTokens: number;
  }>;
  tokenBudget: {
    fixture: string;
    maxTokens: number;
    fullTokens: number;
    budgetedTokens: number;
  };
};
check(compressionExpectations.schemaVersion === 1, "unsupported compression snapshot schema");
const benchmarkRows = compressionExpectations.fixtures.map((fixture) => {
  const reduction = ((1 - fixture.tideSurfTokens / fixture.sourceHtmlTokens) * 100).toFixed(0);
  const ratio = (fixture.sourceHtmlTokens / fixture.tideSurfTokens).toFixed(1);
  return `| ${fixture.label} | ${fixture.sourceHtmlTokens.toLocaleString("en-US")} tokens | ${fixture.renderedDomTokens.toLocaleString("en-US")} tokens | ${fixture.tideSurfTokens.toLocaleString("en-US")} tokens | ${reduction}% | ${ratio}x |`;
});
const documentedBenchmarkRows = markdownSection(
  benchmarkDocs,
  "## Reproducible fixture results"
).split("\n").filter((line) =>
  compressionExpectations.fixtures.some((fixture) =>
    line.startsWith(`| ${fixture.label} |`)
  )
);
equal(
  documentedBenchmarkRows,
  benchmarkRows,
  "benchmark docs table must match the executable snapshot"
);
const budgetFixture = compressionExpectations.fixtures.find(
  (fixture) => fixture.name === compressionExpectations.tokenBudget.fixture
);
check(budgetFixture !== undefined, "token-budget snapshot must reference a fixture");
if (budgetFixture) {
  equal(
    compressionExpectations.tokenBudget.fullTokens,
    budgetFixture.tideSurfTokens,
    "token-budget full count must match its fixture"
  );
}
if (budgetFixture) {
  const embeddedSource = landing.match(/class="tokens-before">([^<]+)</)?.[1];
  const embeddedTideSurf = landing.match(/class="specimen-shift"[\s\S]*?<strong>([^<]+)<\/strong>/)?.[1];
  equal(
    [embeddedSource, embeddedTideSurf],
    [
      budgetFixture.sourceHtmlTokens.toLocaleString("en-US"),
      budgetFixture.tideSurfTokens.toLocaleString("en-US"),
    ],
    "landing benchmark embed must match the executable snapshot"
  );
}
const budgetPhrase = budgetFixture
  ? `${compressionExpectations.tokenBudget.fullTokens}-token ${budgetFixture.label.toLowerCase()} state to ${compressionExpectations.tokenBudget.budgetedTokens} tokens with a ${compressionExpectations.tokenBudget.maxTokens}-token target`
  : "";
check(
  benchmarkDocs.includes(budgetPhrase),
  "benchmark docs must include the current deterministic token-budget result"
);
const liveBenchmark = read("scripts/benchmark-live.ts");
for (const [constant, label] of [
  ["MIN_RAW_TOKENS", "rendered tokens"],
  ["MIN_COMPRESSED_TOKENS", "TideSurf tokens"],
  ["MIN_ACTION_IDS", "action IDs"],
] as const) {
  const literal = liveBenchmark.match(new RegExp(`const ${constant} = ([\\d_]+);`))?.[1];
  check(literal !== undefined, `live benchmark must define ${constant}`);
  if (literal !== undefined) {
    const value = Number(literal.replaceAll("_", ""));
    check(
      benchmarkDocs.includes(`${value.toLocaleString("en-US")} ${label}`),
      `benchmark docs must describe ${constant}`
    );
  }
}
check(
  liveBenchmark.includes("const aggregateRatio = totalRaw / totalCompressed"),
  "live benchmark must calculate an aggregate ratio"
);
check(
  benchmarkDocs.includes("divides total rendered tokens by total TideSurf tokens"),
  "benchmark docs must describe the aggregate ratio"
);

const packageJson = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
check(packageJson.scripts?.["demo"] === undefined, "package must not expose the retired demo script");
for (const path of terminologyPaths) {
  check(!/TideTravel|demo\/serve\.ts|demo\/prompt\.md|bun run demo/.test(read(path)), `${path} contains a retired demo reference`);
}

const ogHtml = read("website/landing/public/og.html");
const ogSvg = read("website/landing/public/og.svg");
for (const value of ["Live DOM → compact text → current action handles.", "bunx @tidesurf/core"]) {
  check(ogHtml.includes(value), `og.html must include: ${value}`);
  check(ogSvg.includes(value), `og.svg must include: ${value}`);
}
const ogManifest = JSON.parse(read("website/landing/public/og-manifest.json")) as {
  sourceSha256: string;
  pngSha256: string;
  width: number;
  height: number;
};
const ogPng = readFileSync(resolve(root, "website/landing/public/og.png"));
const socialPng = readFileSync(resolve(root, "assets/social-preview.png"));
equal(ogManifest.sourceSha256, sha256(ogHtml), "OG manifest source hash is stale; run bun scripts/generate-og.ts");
equal(ogManifest.pngSha256, sha256(ogPng), "OG manifest PNG hash is stale; run bun scripts/generate-og.ts");
equal(sha256(socialPng), sha256(ogPng), "website and repository social previews must match");
equal(
  { width: ogPng.readUInt32BE(16), height: ogPng.readUInt32BE(20) },
  { width: ogManifest.width, height: ogManifest.height },
  "OG PNG dimensions must match its manifest"
);

const rootChangelog = read("CHANGELOG.md");
const webChangelog = read("website/docs/content/changelog.md");
equal(
  markdownSection(webChangelog, "## Unreleased"),
  markdownSection(rootChangelog, "## Unreleased"),
  "root and website Unreleased changelog sections must be identical"
);
const releaseHeadings = (source: string): string[] =>
  [...source.matchAll(/^## (\d+\.\d+\.\d+ \([^\n]+\))$/gm)].map((match) => match[1]);
equal(
  releaseHeadings(webChangelog),
  releaseHeadings(rootChangelog),
  "root and website changelogs must cover the same released versions"
);

for (const path of [
  "README.md",
  "README.ja.md",
  "README.ko.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  ...contentNames.map((name) => `website/docs/content/${name}.md`),
]) {
  for (const rawTarget of markdownLinks(read(path))) {
    const target = rawTarget.replace(/^<|>$/g, "").split("#", 1)[0].split("?", 1)[0];
    if (!target || /^(?:https?:|mailto:)/.test(target)) continue;
    check(
      existsSync(resolve(root, dirname(path), decodeURIComponent(target))),
      `${path} links to missing local target ${rawTarget}`
    );
  }
}

for (const path of ["examples/agent.ts", "website/docs/content/agent-patterns.md"]) {
  check(!/claude-[\w-]+-\d{8}/.test(read(path)), `${path} must not pin a dated model ID`);
}

if (failures.length > 0) {
  console.error(`Documentation sync failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Documentation sync passed: ${TOOL_REGISTRY.length} tools, ${contentNames.length} docs pages, synchronized llms/changelog/OG embeds.`);
