import { lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseFrontmatter } from "./frontmatter.js";
import type { FrontmatterParse } from "./frontmatter.js";

export const MAX_SKILL_BODY_BYTES = 64 * 1024;

const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_SKILL_DESCRIPTION_CHARS = 1024;
const MAX_SKILL_COMPATIBILITY_CHARS = 500;
const MAX_SKILL_FILES = 1000;
const TRUNCATED_BODY_MARK = "\n\n[skill body truncated]";

export interface SkillInfo {
  readonly name: string;
  readonly description: string;
  readonly directory: string;
  readonly source: "project" | "user";
  readonly plugin?: string;
  readonly body: string;
  readonly files: readonly string[];
  readonly license?: string;
  readonly compatibility?: string;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly allowedTools?: string;
}

export interface SkillDiagnostic {
  readonly skill?: string;
  readonly directory: string;
  readonly message: string;
}

interface SkillInfoDraft {
  name: string;
  description: string;
  directory: string;
  source: "project" | "user";
  plugin?: string;
  body: string;
  files: string[];
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  allowedTools?: string;
}

export function validateSkillName(name: string): string | undefined {
  if (name.length === 0 || name.length > 64) {
    return "skill name must be 1-64 characters";
  }
  if (!SKILL_NAME_PATTERN.test(name)) {
    return `skill name "${name}" must be lowercase alphanumeric words separated by single hyphens`;
  }
  return undefined;
}

// Paths are built segment by segment so the walk never resolves a symlink:
// entries are classified with lstat and only real directories are descended into.
function listSkillFiles(directory: string): string[] {
  const files: string[] = [];
  const walk = (current: string, prefix: string): void => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      let stats;
      try {
        stats = lstatSync(join(current, entry.name));
      } catch {
        continue;
      }
      if (stats.isDirectory()) {
        walk(join(current, entry.name), relative);
      } else if (stats.isFile() && relative !== "SKILL.md") {
        files.push(relative);
      }
    }
  };
  walk(directory, "");
  return files.sort();
}

export function loadSkillDirectory(
  directory: string,
  source: "project" | "user",
  plugin?: string
): { skill?: SkillInfo; diagnostics: SkillDiagnostic[] } {
  const resolvedDirectory = resolve(directory);
  const diagnostics: SkillDiagnostic[] = [];
  const report = (message: string, skillName?: string): void => {
    diagnostics.push({
      directory: resolvedDirectory,
      message,
      ...(skillName === undefined ? {} : { skill: skillName }),
    });
  };

  const skillMdPath = join(resolvedDirectory, "SKILL.md");
  let raw: string;
  try {
    if (!statSync(skillMdPath).isFile()) {
      report("SKILL.md is not a regular file");
      return { diagnostics };
    }
    raw = readFileSync(skillMdPath, "utf8");
  } catch {
    report("SKILL.md is not readable");
    return { diagnostics };
  }

  let parsed: FrontmatterParse;
  try {
    const result = parseFrontmatter(raw);
    if (result === null) {
      report("SKILL.md has no frontmatter block");
      return { diagnostics };
    }
    parsed = result;
  } catch (error) {
    report(
      `SKILL.md frontmatter is not parseable: ${error instanceof Error ? error.message : String(error)}`
    );
    return { diagnostics };
  }

  const directoryName = basename(resolvedDirectory);
  const rawName = parsed.data.name;
  let name: string | undefined;
  if (typeof rawName === "string" && validateSkillName(rawName) === undefined) {
    name = rawName;
    if (name !== directoryName) {
      report(`frontmatter name "${name}" does not match directory name "${directoryName}"`, name);
    }
  }
  if (name === undefined) {
    const reason =
      typeof rawName !== "string"
        ? "frontmatter name is missing"
        : (validateSkillName(rawName) ?? "frontmatter name is invalid");
    if (validateSkillName(directoryName) === undefined) {
      name = directoryName;
      report(`${reason}; using directory name "${directoryName}"`, name);
    } else {
      report(`${reason}; directory name "${directoryName}" is not a valid skill name, skipping`);
      return { diagnostics };
    }
  }

  const rawDescription = parsed.data.description;
  if (typeof rawDescription !== "string" || rawDescription.trim() === "") {
    report("frontmatter description is missing or empty, skipping", name);
    return { diagnostics };
  }
  const description = rawDescription;
  if (description.length > MAX_SKILL_DESCRIPTION_CHARS) {
    report(
      `description is ${description.length} characters (max ${MAX_SKILL_DESCRIPTION_CHARS})`,
      name
    );
  }

  const skill: SkillInfoDraft = {
    name,
    description,
    directory: resolvedDirectory,
    source,
    body: parsed.body,
    files: [],
  };
  if (plugin !== undefined) skill.plugin = plugin;

  const rawLicense = parsed.data.license;
  if (typeof rawLicense === "string") skill.license = rawLicense;

  const rawCompatibility = parsed.data.compatibility;
  if (rawCompatibility !== undefined) {
    if (typeof rawCompatibility === "string") {
      skill.compatibility = rawCompatibility;
      if (rawCompatibility.length > MAX_SKILL_COMPATIBILITY_CHARS) {
        report(
          `compatibility is ${rawCompatibility.length} characters (max ${MAX_SKILL_COMPATIBILITY_CHARS})`,
          name
        );
      }
    } else {
      report("compatibility must be a string, ignoring", name);
    }
  }

  const rawMetadata = parsed.data.metadata;
  if (rawMetadata !== undefined) {
    if (typeof rawMetadata === "object" && rawMetadata !== null && !Array.isArray(rawMetadata)) {
      const metadata: Record<string, string> = {};
      for (const [key, value] of Object.entries(rawMetadata)) {
        if (typeof value === "string") {
          metadata[key] = value;
        } else {
          report(`metadata.${key} must be a string, dropping entry`, name);
        }
      }
      skill.metadata = metadata;
    } else {
      report("metadata must be a map of strings, ignoring", name);
    }
  }

  const rawAllowedTools = parsed.data["allowed-tools"];
  if (rawAllowedTools !== undefined) {
    // The spec defines a space-separated string; real-world skills also use
    // YAML block sequences, so accept a string list and join it.
    if (typeof rawAllowedTools === "string") {
      skill.allowedTools = rawAllowedTools;
    } else if (
      Array.isArray(rawAllowedTools) &&
      rawAllowedTools.every((entry) => typeof entry === "string")
    ) {
      skill.allowedTools = rawAllowedTools.join(" ");
    } else {
      report("allowed-tools must be a string or a list of strings, ignoring", name);
    }
  }

  if (Buffer.byteLength(skill.body, "utf8") > MAX_SKILL_BODY_BYTES) {
    skill.body =
      Buffer.from(skill.body, "utf8").subarray(0, MAX_SKILL_BODY_BYTES).toString("utf8") +
      TRUNCATED_BODY_MARK;
    report(`skill body exceeds ${MAX_SKILL_BODY_BYTES} bytes, truncated`, name);
  }

  const files = listSkillFiles(resolvedDirectory);
  if (files.length > MAX_SKILL_FILES) {
    skill.files = files.slice(0, MAX_SKILL_FILES);
    report(
      `skill directory contains more than ${MAX_SKILL_FILES} files, listing first ${MAX_SKILL_FILES}`,
      name
    );
  } else {
    skill.files = files;
  }

  return { skill, diagnostics };
}
