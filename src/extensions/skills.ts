import {
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseFrontmatter } from "./frontmatter.js";
import type { FrontmatterParse } from "./frontmatter.js";

export const MAX_SKILL_DOCUMENT_BYTES = 64 * 1024;
/** @deprecated Use MAX_SKILL_DOCUMENT_BYTES. The limit applies to the complete SKILL.md file. */
export const MAX_SKILL_BODY_BYTES = MAX_SKILL_DOCUMENT_BYTES;
export const MAX_SKILL_FILES = 1000;
export const MAX_SKILL_DIRECTORIES = 256;
export const MAX_SKILL_DIRECTORY_DEPTH = 16;

const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_SKILL_DESCRIPTION_CHARS = 1024;
const MAX_SKILL_COMPATIBILITY_CHARS = 500;
const SKILL_FIELDS = new Set([
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "allowed-tools",
]);

export interface SkillInfo {
  readonly name: string;
  readonly description: string;
  readonly directory: string;
  readonly source: "project" | "user";
  readonly plugin?: string;
  readonly license?: string;
  readonly compatibility?: string;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly allowedTools?: string;
  /** @deprecated Use loadSkillDocument(skill).body so resources remain on demand. */
  readonly body: string;
  /** @deprecated Use loadSkillDocument(skill).files so resources remain on demand. */
  readonly files: readonly string[];
}

export interface SkillDocument {
  readonly raw: string;
  readonly body: string;
  readonly files: readonly string[];
}

export interface SkillDiagnostic {
  readonly skill?: string;
  readonly directory: string;
  readonly message: string;
}

interface SkillMetadataDraft {
  name: string;
  description: string;
  directory: string;
  source: "project" | "user";
  plugin?: string;
  license?: string;
  compatibility?: string;
  metadata?: Readonly<Record<string, string>>;
  allowedTools?: string;
}

interface WalkDirectory {
  readonly absolute: string;
  readonly relative: string;
  readonly depth: number;
}

class SkillFileError extends Error {}

function characterCount(value: string): number {
  return Array.from(value).length;
}

function readSkillFile(directory: string): string {
  const skillMdPath = join(directory, "SKILL.md");
  let descriptor: number;
  try {
    descriptor = openSync(skillMdPath, "r");
  } catch {
    throw new SkillFileError("SKILL.md is not readable");
  }

  try {
    if (!fstatSync(descriptor).isFile()) {
      throw new SkillFileError("SKILL.md is not a regular file");
    }
    const bytes = Buffer.allocUnsafe(MAX_SKILL_DOCUMENT_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = readSync(descriptor, bytes, length, bytes.length - length, null);
      if (read === 0) break;
      length += read;
    }
    if (length > MAX_SKILL_DOCUMENT_BYTES) {
      throw new SkillFileError(
        `SKILL.md exceeds the ${MAX_SKILL_DOCUMENT_BYTES}-byte limit`
      );
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length));
    } catch {
      throw new SkillFileError("SKILL.md is not valid UTF-8");
    }
  } finally {
    closeSync(descriptor);
  }
}

function parseSkillFile(raw: string): FrontmatterParse {
  let parsed: FrontmatterParse | null;
  try {
    parsed = parseFrontmatter(raw);
  } catch (error) {
    throw new SkillFileError(
      `SKILL.md frontmatter is not parseable: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (parsed === null) throw new SkillFileError("SKILL.md has no frontmatter block");
  return parsed;
}

function listSkillFiles(directory: string): string[] {
  const files: string[] = [];
  const queue: WalkDirectory[] = [{ absolute: directory, relative: "", depth: 0 }];
  let cursor = 0;
  let directoryCount = 1;

  while (cursor < queue.length) {
    const current = queue[cursor];
    cursor += 1;
    let entries;
    try {
      entries = readdirSync(current.absolute, { withFileTypes: true }).sort((left, right) =>
        left.name.localeCompare(right.name)
      );
    } catch {
      const display = current.relative === "" ? "." : current.relative;
      throw new SkillFileError(`skill resource directory "${display}" is not readable`);
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const relative = current.relative === "" ? entry.name : `${current.relative}/${entry.name}`;
      const absolute = join(current.absolute, entry.name);
      let stats;
      try {
        stats = lstatSync(absolute);
      } catch {
        throw new SkillFileError(`skill resource "${relative}" is not readable`);
      }
      if (stats.isSymbolicLink()) continue;
      if (stats.isDirectory()) {
        const depth = current.depth + 1;
        if (depth > MAX_SKILL_DIRECTORY_DEPTH) {
          throw new SkillFileError(
            `skill resources exceed the directory depth limit of ${MAX_SKILL_DIRECTORY_DEPTH}`
          );
        }
        directoryCount += 1;
        if (directoryCount > MAX_SKILL_DIRECTORIES) {
          throw new SkillFileError(
            `skill resources exceed the directory limit of ${MAX_SKILL_DIRECTORIES}`
          );
        }
        queue.push({ absolute, relative, depth });
      } else if (stats.isFile() && relative !== "SKILL.md") {
        files.push(relative);
        if (files.length > MAX_SKILL_FILES) {
          throw new SkillFileError(`skill resources exceed the file limit of ${MAX_SKILL_FILES}`);
        }
      }
    }
  }

  return files.sort();
}

function withCompatibilityDocumentFields(
  metadata: SkillMetadataDraft,
  body: string
): SkillInfo {
  let files: readonly string[] | undefined;
  return Object.defineProperties(metadata, {
    body: {
      enumerable: false,
      value: body,
    },
    files: {
      enumerable: false,
      get: () => {
        files ??= listSkillFiles(metadata.directory);
        return files;
      },
    },
  }) as SkillInfo;
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
  const reject = (message: string, skillName?: string): { diagnostics: SkillDiagnostic[] } => {
    report(`${message}, skipping`, skillName);
    return { diagnostics };
  };

  let raw: string;
  let parsed: FrontmatterParse;
  try {
    raw = readSkillFile(resolvedDirectory);
    parsed = parseSkillFile(raw);
  } catch (error) {
    return reject(error instanceof Error ? error.message : String(error));
  }

  const directoryName = basename(resolvedDirectory);
  const rawName = Object.hasOwn(parsed.data, "name") ? parsed.data.name : undefined;
  if (typeof rawName !== "string") {
    return reject("frontmatter name is missing or is not a string");
  }
  const invalidName = validateSkillName(rawName);
  if (invalidName !== undefined) return reject(invalidName, rawName);
  if (rawName !== directoryName) {
    return reject(
      `frontmatter name "${rawName}" does not match directory name "${directoryName}"`,
      rawName
    );
  }
  const name = rawName;

  for (const field of Object.keys(parsed.data)) {
    if (!SKILL_FIELDS.has(field)) return reject(`unknown frontmatter field "${field}"`, name);
  }

  const rawDescription = Object.hasOwn(parsed.data, "description")
    ? parsed.data.description
    : undefined;
  if (typeof rawDescription !== "string" || rawDescription.trim() === "") {
    return reject("frontmatter description is missing, empty, or not a string", name);
  }
  const descriptionLength = characterCount(rawDescription);
  if (descriptionLength > MAX_SKILL_DESCRIPTION_CHARS) {
    return reject(
      `description is ${descriptionLength} characters (max ${MAX_SKILL_DESCRIPTION_CHARS})`,
      name
    );
  }

  const metadata: SkillMetadataDraft = {
    name,
    description: rawDescription,
    directory: resolvedDirectory,
    source,
  };
  if (plugin !== undefined) metadata.plugin = plugin;

  if (Object.hasOwn(parsed.data, "license")) {
    const rawLicense = parsed.data.license;
    if (typeof rawLicense !== "string") return reject("license must be a string", name);
    metadata.license = rawLicense;
  }

  if (Object.hasOwn(parsed.data, "compatibility")) {
    const rawCompatibility = parsed.data.compatibility;
    if (typeof rawCompatibility !== "string" || rawCompatibility.trim() === "") {
      return reject("compatibility must be a nonempty string", name);
    }
    const compatibilityLength = characterCount(rawCompatibility);
    if (compatibilityLength > MAX_SKILL_COMPATIBILITY_CHARS) {
      return reject(
        `compatibility is ${compatibilityLength} characters (max ${MAX_SKILL_COMPATIBILITY_CHARS})`,
        name
      );
    }
    metadata.compatibility = rawCompatibility;
  }

  if (Object.hasOwn(parsed.data, "metadata")) {
    const rawMetadata = parsed.data.metadata;
    if (typeof rawMetadata !== "object" || rawMetadata === null || Array.isArray(rawMetadata)) {
      return reject("metadata must be a map of strings", name);
    }
    const values = Object.create(null) as Record<string, string>;
    for (const key of Object.keys(rawMetadata)) {
      const value = (rawMetadata as Record<string, unknown>)[key];
      if (typeof value !== "string") {
        return reject(`metadata.${key} must be a string`, name);
      }
      values[key] = value;
    }
    metadata.metadata = values;
  }

  if (Object.hasOwn(parsed.data, "allowed-tools")) {
    const rawAllowedTools = parsed.data["allowed-tools"];
    if (typeof rawAllowedTools !== "string") {
      return reject("allowed-tools must be a string", name);
    }
    metadata.allowedTools = rawAllowedTools;
  }

  return { skill: withCompatibilityDocumentFields(metadata, parsed.body), diagnostics };
}

export function loadSkillDocument(skill: SkillInfo): SkillDocument {
  const raw = readSkillFile(skill.directory);
  const parsed = parseSkillFile(raw);
  return {
    raw,
    body: parsed.body,
    files: listSkillFiles(skill.directory),
  };
}
