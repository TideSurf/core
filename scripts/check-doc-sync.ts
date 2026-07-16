#!/usr/bin/env bun

import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import {
  aggregateLiveResults,
  LIVE_BENCHMARK_THRESHOLDS,
} from "./benchmark-live.js";
import { commandHelp, generalHelp } from "../src/cli/help.js";
import {
  CLI_EXIT_CODES,
  GLOBAL_OPTIONS,
  LIFECYCLE_COMMANDS,
} from "../src/cli/metadata.js";
import { TOOL_REGISTRY } from "../src/tools/registry.js";
import { translations } from "../website/docs/src/translations.js";
import { releaseMetadataFailures } from "./check-release.js";

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
const canonicalToolNames = TOOL_REGISTRY.map((tool) => tool.name);
const nonCanonicalToolNames = canonicalToolNames
  .filter((name) => name.includes("_"))
  .map((name) => name.replaceAll("_", "-"));

const llms = read("llms.txt");
const publicLlms = read("website/landing/public/llms.txt");
equal(publicLlms, llms, "website llms.txt must be byte-identical to package llms.txt");

const installCommands = [
  "brew install TideSurf/tap/tidesurf",
  "npm install --global @tidesurf/core",
] as const;
for (const path of [
  "README.md",
  "README.ja.md",
  "README.ko.md",
  "llms.txt",
  "website/docs/content/getting-started.md",
  "website/docs/content/cli.md",
  "website/docs/content/migration.md",
]) {
  const source = read(path);
  for (const command of installCommands) {
    check(
      source.split(command).length === 2,
      `${path} must contain the canonical install command once: ${command}`
    );
  }
  check(!source.includes("bunx @tidesurf/core"), `${path} contains the retired bunx flow`);
}

const llmsTools = [...markdownSection(llms, "Direct tool commands, in registry order:").matchAll(
  /^(\d+)\. `([^`]+)`$/gm
)].map((match) => ({
  index: Number(match[1]),
  command: match[2],
}));
equal(
  llmsTools,
  TOOL_REGISTRY.map((tool, index) => ({
    index: index + 1,
    command: tool.name,
  })),
  "llms.txt direct tool list must match canonical registry order"
);

const api = read("website/docs/content/api-reference.md");
const apiRows = [...markdownSection(api, "## Canonical tools").matchAll(
  /^\| `([^`]+)` \| ([^|]+?) \| (yes|no) \|$/gm
)].map((match) => ({
  name: match[1],
  inputs: match[2] === "none"
    ? []
    : [...match[2].matchAll(/`([^`]+)`/g)].map((input) => input[1]),
  readOnly: match[3] === "yes",
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
      readOnly: tool.readOnlyAllowed,
    };
  }),
  "API canonical-tool table must match the registry"
);

const cliDocs = read("website/docs/content/cli.md");
const cliRows = [...markdownSection(cliDocs, "## Direct tool commands").matchAll(
  /^\| `([^`]+)` \|/gm
)].map((match) => ({
  command: match[1].split(/\s/, 1)[0],
}));
equal(
  cliRows,
  TOOL_REGISTRY.map((tool) => ({
    command: tool.name,
  })),
  "CLI direct-command table must match canonical registry names"
);

const generatedHelp = generalHelp();
const generatedHelpNames = ["Read commands", "Mutation and sensitive commands"]
  .flatMap((heading) => {
    const body = generatedHelp.match(
      new RegExp(`${heading}:\\n([\\s\\S]*?)(?:\\n\\n|$)`)
    )?.[1] ?? "";
    return [...body.matchAll(/^  ([a-z_]+)\s{2,}/gm)].map((match) => match[1]);
  });
equal(
  generatedHelpNames,
  [
    ...TOOL_REGISTRY.filter((tool) => tool.readOnlyAllowed),
    ...TOOL_REGISTRY.filter((tool) => !tool.readOnlyAllowed),
  ].map((tool) => tool.name),
  "generated CLI help must list exact registry names"
);
for (const tool of TOOL_REGISTRY) {
  const help = commandHelp(tool.name) ?? "";
  check(
    help.startsWith(`${tool.name}\n`) && help.includes(`\n  tidesurf ${tool.name}`),
    `generated CLI help must use the exact ${tool.name} identifier`
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
const securityAllowed = markdownSection(security, "## Read-only mode")
  .split("\nIt rejects:", 1)[0]
  .match(/^- `([^`]+)`$/gm)
  ?.map((line) => line.slice(3, -1)) ?? [];
equal(securityAllowed, expectedReadOnlyNames, "security read-only list must match the registry");
for (const path of [
  "llms.txt",
  "website/docs/content/api-reference.md",
  "website/docs/content/security.md",
]) {
  check(
    read(path).includes("fileAccessRoots: []"),
    `${path} must document that an empty SDK fileAccessRoots array disables file access`
  );
}

const documentedLifecycle = [...markdownSection(
  cliDocs,
  "## Lifecycle and discovery commands"
).matchAll(/^\| `tidesurf (.+)` \| ([^|]+) \|$/gm)].map((match) => ({
  synopsis: match[1].replaceAll("\\|", "|"),
  summary: match[2].trim(),
}));
equal(
  documentedLifecycle,
  LIFECYCLE_COMMANDS.map(({ synopsis, summary }) => ({ synopsis, summary })),
  "CLI lifecycle table must match command metadata"
);

const documentedGlobalOptions = [...markdownSection(
  cliDocs,
  "## Global options"
).matchAll(/^\| `(--[a-z-]+)(?: [^`]*)?` \| ([^|]+) \|$/gm)].map((match) => ({
  flag: match[1],
  description: match[2].trim(),
}));
equal(
  documentedGlobalOptions,
  GLOBAL_OPTIONS.map(({ flag, description }) => ({ flag, description })),
  "CLI global-option table must match option metadata"
);
for (const { flag } of GLOBAL_OPTIONS) {
  check(generalHelp().includes(flag), `generated CLI help must include ${flag}`);
}

const expectedExitCodes = Object.values(CLI_EXIT_CODES);
const documentedExitCodes = [...markdownSection(
  cliDocs,
  "## Output"
).matchAll(/^\| `(\d+)` \| ([^|]+) \|$/gm)].map((match) => ({
  code: Number(match[1]),
  meaning: match[2].trim(),
}));
equal(documentedExitCodes, expectedExitCodes, "CLI exit-code table must match runtime metadata");
const llmsExitCodes = (llms.match(/^Exit codes: (.+)\.$/m)?.[1] ?? "")
  .split("; ")
  .filter(Boolean)
  .map((entry) => {
    const match = /^(\d+) (.+)$/.exec(entry);
    return { code: Number(match?.[1]), meaning: match?.[2] ?? "" };
  });
equal(llmsExitCodes, expectedExitCodes, "llms.txt exit codes must match runtime metadata");

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

const publicToolNamePaths = [
  "README.md",
  "README.ja.md",
  "README.ko.md",
  "llms.txt",
  "CHANGELOG.md",
  "website/PRODUCT.md",
  "website/DESIGN.md",
  "website/docs/index.html",
  "website/docs/src/main.ts",
  "website/docs/src/translations.ts",
  "website/landing/index.html",
  "website/landing/src/main.ts",
  "website/landing/public/llms.txt",
  "website/landing/public/og.html",
  ...readdirSync(resolve(root, "examples"))
    .filter((name) => name.endsWith(".ts"))
    .map((name) => `examples/${name}`),
  ...contentNames.map((name) => `website/docs/content/${name}.md`),
];
for (const path of publicToolNamePaths) {
  const source = read(path);
  for (const nonCanonicalName of nonCanonicalToolNames) {
    check(
      !source.includes(nonCanonicalName),
      `${path} uses non-canonical tool spelling ${nonCanonicalName}`
    );
  }
}
for (const nonCanonicalName of nonCanonicalToolNames) {
  check(
    !generatedHelp.includes(nonCanonicalName),
    `generated CLI help uses non-canonical tool spelling ${nonCanonicalName}`
  );
}
for (const [label, source] of [
  ["CLI direct-command docs", markdownSection(cliDocs, "## Direct tool commands")],
  ["API canonical-tool docs", markdownSection(api, "## Canonical tools")],
  ["llms.txt direct-command docs", markdownSection(llms, "Direct tool commands, in registry order:")],
] as const) {
  check(
    !/(?:kebab-case|CLI alias|command alias|both spellings|underscore names?)/i.test(source),
    `${label} must not describe alternate tool spellings`
  );
}

for (const key of [...docsIndex.matchAll(/data-i18n(?:-placeholder)?="([^"]+)"/g)].map((match) => match[1])) {
  check(Object.hasOwn(translations, key), `missing docs translation key: ${key}`);
}

const expectedPageHeader = "> example.com/search | 0/1200 800vh";
for (const path of [
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
if (!budgetFixture) {
  check(false, "token-budget snapshot must reference a fixture");
} else {
  equal(
    compressionExpectations.tokenBudget.fullTokens,
    budgetFixture.tideSurfTokens,
    "token-budget full count must match its fixture"
  );
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
  const budgetPhrase = `${compressionExpectations.tokenBudget.fullTokens}-token ${budgetFixture.label.toLowerCase()} state to ${compressionExpectations.tokenBudget.budgetedTokens} tokens with a ${compressionExpectations.tokenBudget.maxTokens}-token target`;
  check(
    benchmarkDocs.includes(budgetPhrase),
    "benchmark docs must include the current deterministic token-budget result"
  );
}
for (const [value, label] of [
  [LIVE_BENCHMARK_THRESHOLDS.rawTokens, "rendered tokens"],
  [LIVE_BENCHMARK_THRESHOLDS.tideSurfTokens, "TideSurf tokens"],
  [LIVE_BENCHMARK_THRESHOLDS.actionIds, "action IDs"],
] as const) {
  check(
    benchmarkDocs.includes(`${value.toLocaleString("en-US")} ${label}`),
    `benchmark docs must describe the ${label} acceptance threshold`
  );
}
equal(
  aggregateLiveResults([
    { rawTokens: 900, tideSurfTokens: 100, ms: 10 },
    { rawTokens: 100, tideSurfTokens: 100, ms: 30 },
  ]),
  {
    avgMs: 20,
    totalRaw: 1_000,
    totalCompressed: 200,
    ratio: 5,
    reduction: 80,
  },
  "live benchmark aggregation must use totals"
);
check(
  benchmarkDocs.includes("divides total rendered tokens by total TideSurf tokens"),
  "benchmark docs must describe the aggregate ratio"
);

const packageJson = JSON.parse(read("package.json")) as {
  scripts?: Record<string, string>;
  version?: string;
};
check(packageJson.scripts?.["demo"] === undefined, "package must not expose the retired demo script");
for (const name of readdirSync(resolve(root, ".github/workflows"))) {
  if (!name.endsWith(".yml") && !name.endsWith(".yaml")) continue;
  for (const match of read(`.github/workflows/${name}`).matchAll(/\buses:\s*[^@\s]+@([^\s#]+)/g)) {
    check(
      /^[0-9a-f]{40}$/.test(match[1]),
      `.github/workflows/${name} must pin actions to full commit SHAs`
    );
  }
}
for (const path of terminologyPaths) {
  check(!/TideTravel|demo\/serve\.ts|demo\/prompt\.md|bun run demo/.test(read(path)), `${path} contains a retired demo reference`);
}

const ogHtml = read("website/landing/public/og.html");
const landingHtml = read("website/landing/index.html");
const hero = landingHtml.match(/<h1 id="hero-title">([^<]+)<\/h1>/)?.[1];
const heroCommand = landingHtml.match(/data-copy="([^"]+)"/)?.[1];
check(hero === "Agents Surfing", "landing hero must be exactly Agents Surfing");
check(
  heroCommand === "tidesurf navigate https://example.com",
  "landing command must use the installed TideSurf CLI"
);
for (const value of [
  hero,
  "Live DOM → compact text → current action handles.",
  heroCommand,
]) {
  if (!value) continue;
  check(ogHtml.includes(value), `og.html must include: ${value}`);
}
for (const retired of ["The live page.", "Agents surfing.", "bunx @tidesurf/core"]) {
  check(!ogHtml.includes(retired), `og.html contains retired copy: ${retired}`);
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
failures.push(...releaseMetadataFailures());
equal(
  markdownSection(webChangelog, "## Unreleased"),
  markdownSection(rootChangelog, "## Unreleased"),
  "root and website Unreleased changelog sections must be identical"
);
const currentReleaseSection = (source: string): string => {
  if (!packageJson.version) return "";
  const version = packageJson.version.replaceAll(".", "\\.");
  const heading = source.match(
    new RegExp(`^## ${version} \\([^\\n]+\\)$`, "m")
  )?.[0];
  return heading ? markdownSection(source, heading) : "";
};
const rootCurrentRelease = currentReleaseSection(rootChangelog);
const webCurrentRelease = currentReleaseSection(webChangelog);
check(rootCurrentRelease !== "", "root changelog must contain the current release");
check(webCurrentRelease !== "", "website changelog must contain the current release");
equal(
  webCurrentRelease,
  rootCurrentRelease,
  "root and website current release notes must be identical"
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
