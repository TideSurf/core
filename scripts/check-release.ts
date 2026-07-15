#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { VERSION } from "../src/version.js";

const root = resolve(import.meta.dir, "..");

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unreleasedContent(source: string): string {
  const start = source.indexOf("## Unreleased");
  if (start < 0) return "";
  const bodyStart = start + "## Unreleased".length;
  const nextRelease = source.slice(bodyStart).search(/^## \d/m);
  return source.slice(
    bodyStart,
    nextRelease < 0 ? undefined : bodyStart + nextRelease
  ).trim();
}

export function releaseMetadataFailures(releaseTag?: string): string[] {
  const failures: string[] = [];
  const packageVersion = (JSON.parse(read("package.json")) as { version?: unknown }).version;
  if (typeof packageVersion !== "string") {
    return ["package.json must contain a string version"];
  }

  if (VERSION !== packageVersion) {
    failures.push(`src/version.ts has ${VERSION}; package.json has ${packageVersion}`);
  }

  if (releaseTag !== undefined && releaseTag !== `v${packageVersion}`) {
    failures.push(`release tag ${releaseTag} must be v${packageVersion}`);
  }

  const heading = new RegExp(`^## ${escapeRegExp(packageVersion)} \\(\\d{4}-\\d{2}-\\d{2}\\)$`, "gm");
  for (const path of ["CHANGELOG.md", "website/docs/content/changelog.md"]) {
    const changelog = read(path);
    if ([...changelog.matchAll(heading)].length !== 1) {
      failures.push(`${path} must contain one dated ${packageVersion} release heading`);
    }
    if (releaseTag !== undefined && unreleasedContent(changelog) !== "") {
      failures.push(`${path} must have an empty Unreleased section for ${releaseTag}`);
    }
  }
  return failures;
}

if (import.meta.main) {
  const releaseTag = process.env.RELEASE_TAG || process.argv[2];
  const failures = releaseMetadataFailures(releaseTag || undefined);
  if (!releaseTag) failures.unshift("set RELEASE_TAG to the published release tag");

  if (failures.length > 0) {
    console.error(`Release metadata check failed (${failures.length}):`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.log(`Release metadata passed for ${releaseTag}.`);
}
