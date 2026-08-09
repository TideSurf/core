import {
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import type { Stats } from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
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
  /** Canonical plugin root used to revalidate containment when the skill is activated. */
  readonly pluginRoot?: string;
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

interface SkillFileRead {
  readonly raw: string;
  readonly canonicalDirectory: string;
}

interface SkillMetadataValidation {
  readonly metadata?: SkillMetadataDraft;
  readonly message?: string;
  readonly skillName?: string;
}

class SkillFileError extends Error {}

function characterCount(value: string): number {
  return Array.from(value).length;
}

function isContained(root: string, target: string): boolean {
  const pathFromRoot = relative(root, target);
  return (
    pathFromRoot === "" ||
    (!isAbsolute(pathFromRoot) && pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`))
  );
}

function sameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function canonicalPluginRoot(pluginRoot: string): string {
  try {
    const canonical = realpathSync(resolve(pluginRoot));
    if (!statSync(canonical).isDirectory()) {
      throw new SkillFileError("plugin root is not a directory");
    }
    return canonical;
  } catch (error) {
    if (error instanceof SkillFileError) throw error;
    throw new SkillFileError("plugin root is not readable");
  }
}

function readSkillFile(directory: string, pluginRoot?: string): SkillFileRead {
  const logicalDirectory = resolve(directory);
  let canonicalDirectory: string;
  let directoryStats: Stats;
  let rootStats: Stats | undefined;
  try {
    canonicalDirectory = realpathSync(logicalDirectory);
    directoryStats = statSync(canonicalDirectory);
    if (!directoryStats.isDirectory()) {
      throw new SkillFileError("skill directory is not a directory");
    }
    if (pluginRoot !== undefined) {
      const currentRoot = realpathSync(pluginRoot);
      if (currentRoot !== pluginRoot || !isContained(pluginRoot, canonicalDirectory)) {
        throw new SkillFileError("skill directory resolves outside the plugin root");
      }
      rootStats = statSync(pluginRoot);
      if (!rootStats.isDirectory()) {
        throw new SkillFileError("plugin root is not a directory");
      }
    }
  } catch (error) {
    if (error instanceof SkillFileError) throw error;
    throw new SkillFileError("skill directory is not readable");
  }

  let canonicalSkillMd: string;
  try {
    canonicalSkillMd = realpathSync(join(logicalDirectory, "SKILL.md"));
  } catch {
    throw new SkillFileError("SKILL.md is not readable");
  }
  if (pluginRoot !== undefined && !isContained(pluginRoot, canonicalSkillMd)) {
    throw new SkillFileError("SKILL.md resolves outside the plugin root");
  }

  let descriptor: number;
  try {
    // Open the resolved target, then parse and validate only the bytes read
    // from this descriptor. A later pathname swap cannot splice metadata from
    // one SKILL.md together with content from another.
    descriptor = openSync(canonicalSkillMd, "r");
  } catch {
    throw new SkillFileError("SKILL.md is not readable");
  }

  try {
    const openedStats = fstatSync(descriptor);
    if (!openedStats.isFile()) {
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

    const closedOverStats = fstatSync(descriptor);
    let currentDirectory: string;
    let currentSkillMd: string;
    let currentDirectoryStats: Stats;
    let currentSkillStats: Stats;
    try {
      currentDirectory = realpathSync(logicalDirectory);
      currentSkillMd = realpathSync(join(logicalDirectory, "SKILL.md"));
      currentDirectoryStats = statSync(currentDirectory);
      currentSkillStats = statSync(currentSkillMd);
    } catch {
      throw new SkillFileError("SKILL.md changed while being read");
    }
    if (
      currentDirectory !== canonicalDirectory ||
      currentSkillMd !== canonicalSkillMd ||
      !sameFile(directoryStats, currentDirectoryStats) ||
      !sameFile(openedStats, closedOverStats) ||
      openedStats.size !== closedOverStats.size ||
      openedStats.mtimeMs !== closedOverStats.mtimeMs ||
      openedStats.ctimeMs !== closedOverStats.ctimeMs ||
      !sameFile(openedStats, currentSkillStats)
    ) {
      throw new SkillFileError("SKILL.md changed while being read");
    }
    if (pluginRoot !== undefined) {
      let currentRoot: string;
      let currentRootStats: Stats;
      try {
        currentRoot = realpathSync(pluginRoot);
        currentRootStats = statSync(currentRoot);
      } catch {
        throw new SkillFileError("plugin root changed while SKILL.md was being read");
      }
      if (
        currentRoot !== pluginRoot ||
        rootStats === undefined ||
        !sameFile(rootStats, currentRootStats) ||
        !isContained(pluginRoot, currentDirectory) ||
        !isContained(pluginRoot, currentSkillMd)
      ) {
        throw new SkillFileError("plugin root changed while SKILL.md was being read");
      }
    }

    try {
      return {
        raw: new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)),
        canonicalDirectory,
      };
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

function validateSkillMetadata(
  parsed: FrontmatterParse,
  directory: string,
  source: "project" | "user",
  plugin?: string
): SkillMetadataValidation {
  const reject = (message: string, skillName?: string): SkillMetadataValidation => ({
    message,
    ...(skillName === undefined ? {} : { skillName }),
  });
  const directoryName = basename(directory);
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
    directory,
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

  return { metadata };
}

function listSkillFiles(directory: string, pluginRoot?: string): string[] {
  let canonicalDirectory: string;
  try {
    canonicalDirectory = realpathSync(resolve(directory));
    if (!statSync(canonicalDirectory).isDirectory()) {
      throw new SkillFileError("skill resource root is not a directory");
    }
  } catch (error) {
    if (error instanceof SkillFileError) throw error;
    throw new SkillFileError("skill resource root is not readable");
  }
  if (pluginRoot !== undefined && !isContained(pluginRoot, canonicalDirectory)) {
    throw new SkillFileError("skill resource root resolves outside the plugin root");
  }

  const files: string[] = [];
  const queue: WalkDirectory[] = [{ absolute: canonicalDirectory, relative: "", depth: 0 }];
  let cursor = 0;
  let directoryCount = 1;

  while (cursor < queue.length) {
    const current = queue[cursor];
    cursor += 1;
    const display = current.relative === "" ? "." : current.relative;
    let entries;
    let beforeStats: Stats;
    try {
      const currentCanonical = realpathSync(current.absolute);
      beforeStats = statSync(currentCanonical);
      if (
        currentCanonical !== current.absolute ||
        !beforeStats.isDirectory() ||
        (pluginRoot !== undefined && !isContained(pluginRoot, currentCanonical))
      ) {
        throw new SkillFileError(`skill resource directory "${display}" changed while being read`);
      }
      entries = readdirSync(current.absolute, { withFileTypes: true }).sort((left, right) =>
        left.name.localeCompare(right.name)
      );
    } catch (error) {
      if (error instanceof SkillFileError) throw error;
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

    try {
      const afterCanonical = realpathSync(current.absolute);
      const afterStats = statSync(afterCanonical);
      if (afterCanonical !== current.absolute || !sameFile(beforeStats, afterStats)) {
        throw new SkillFileError(`skill resource directory "${display}" changed while being read`);
      }
    } catch (error) {
      if (error instanceof SkillFileError) throw error;
      throw new SkillFileError(`skill resource directory "${display}" changed while being read`);
    }
  }

  if (pluginRoot !== undefined) {
    let currentRoot: string;
    try {
      currentRoot = realpathSync(pluginRoot);
    } catch {
      throw new SkillFileError("plugin root changed while skill resources were being read");
    }
    if (currentRoot !== pluginRoot || !isContained(pluginRoot, canonicalDirectory)) {
      throw new SkillFileError("plugin root changed while skill resources were being read");
    }
  }
  return files.sort();
}

function withCompatibilityDocumentFields(
  metadata: SkillMetadataDraft,
  body: string,
  pluginRoot?: string
): SkillInfo {
  let files: readonly string[] | undefined;
  const properties: PropertyDescriptorMap = {
    body: {
      enumerable: false,
      value: body,
    },
    files: {
      enumerable: false,
      get: () => {
        files ??= listSkillFiles(metadata.directory, pluginRoot);
        return files;
      },
    },
  };
  if (pluginRoot !== undefined) {
    properties.pluginRoot = {
      enumerable: false,
      value: pluginRoot,
    };
  }
  return Object.defineProperties(metadata, properties) as SkillInfo;
}

function sameMetadataMap(
  left: Readonly<Record<string, string>> | undefined,
  right: Readonly<Record<string, string>> | undefined
): boolean {
  if (left === undefined || right === undefined) return left === right;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key])
  );
}

function assertDiscoveredMetadata(skill: SkillInfo, current: SkillMetadataDraft): void {
  if (
    skill.name !== current.name ||
    skill.description !== current.description ||
    skill.directory !== current.directory ||
    skill.source !== current.source ||
    skill.plugin !== current.plugin ||
    skill.license !== current.license ||
    skill.compatibility !== current.compatibility ||
    skill.allowedTools !== current.allowedTools ||
    !sameMetadataMap(skill.metadata, current.metadata)
  ) {
    throw new SkillFileError(
      `SKILL.md metadata no longer matches the discovered skill "${skill.name}"`
    );
  }
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
  plugin?: string,
  pluginRoot?: string
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

  let containmentRoot: string | undefined;
  let read: SkillFileRead;
  let parsed: FrontmatterParse;
  try {
    containmentRoot = pluginRoot === undefined ? undefined : canonicalPluginRoot(pluginRoot);
    read = readSkillFile(resolvedDirectory, containmentRoot);
    parsed = parseSkillFile(read.raw);
  } catch (error) {
    return reject(error instanceof Error ? error.message : String(error));
  }

  const validation = validateSkillMetadata(parsed, resolvedDirectory, source, plugin);
  if (validation.metadata === undefined) {
    return reject(validation.message ?? "SKILL.md metadata is invalid", validation.skillName);
  }
  return {
    skill: withCompatibilityDocumentFields(
      validation.metadata,
      parsed.body,
      containmentRoot
    ),
    diagnostics,
  };
}

export function loadSkillDocument(skill: SkillInfo): SkillDocument {
  const read = readSkillFile(skill.directory, skill.pluginRoot);
  const parsed = parseSkillFile(read.raw);
  const validation = validateSkillMetadata(
    parsed,
    resolve(skill.directory),
    skill.source,
    skill.plugin
  );
  if (validation.metadata === undefined) {
    throw new SkillFileError(
      `SKILL.md metadata no longer matches the discovered skill "${skill.name}": ${validation.message ?? "invalid metadata"}`
    );
  }
  assertDiscoveredMetadata(skill, validation.metadata);
  return {
    raw: read.raw,
    body: parsed.body,
    files: listSkillFiles(read.canonicalDirectory, skill.pluginRoot),
  };
}
