import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, join, resolve } from "node:path";
import { loadPlugin } from "./plugins.js";
import type { LoadedPlugin } from "./plugins.js";
import { loadSkillDirectory } from "./skills.js";
import type { SkillInfo } from "./skills.js";

export interface ExtensionRoots {
  readonly pluginsDirs: readonly string[];
  readonly skillsDirs: readonly string[];
}

export type ExtensionsPolicy = "all" | "user" | "off";

export interface ExtensionsSnapshot {
  readonly plugins: readonly LoadedPlugin[];
  readonly skills: readonly SkillInfo[];
  readonly diagnostics: readonly string[];
}

interface RootEntry {
  readonly directory: string;
  readonly source: "project" | "user";
}

interface RootOptions {
  readonly cwd?: string;
  readonly home?: string;
  readonly env?: Record<string, string | undefined>;
}

export function extensionsPolicyFromEnv(
  env: Record<string, string | undefined> = process.env
): ExtensionsPolicy {
  const raw = env.TIDESURF_EXTENSIONS;
  return raw === "user" || raw === "off" ? raw : "all";
}

function splitOverride(value: string | undefined, cwd: string): string[] | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  return value
    .split(delimiter)
    .filter((entry) => entry.trim() !== "")
    .map((entry) => resolve(cwd, entry));
}

// Env-provided roots are classified "user": they must keep working under the
// "user" policy, which forbids project-scoped roots.
function computeRoots(options: RootOptions): { plugins: RootEntry[]; skills: RootEntry[] } {
  const cwd = options.cwd ?? process.cwd();
  const home = options.home ?? homedir();
  const env = options.env ?? process.env;
  const policy = extensionsPolicyFromEnv(env);
  if (policy === "off") return { plugins: [], skills: [] };
  const projectAllowed = policy === "all";
  const pluginOverride = splitOverride(env.TIDESURF_PLUGINS_DIR, cwd);
  const skillOverride = splitOverride(env.TIDESURF_SKILLS_DIR, cwd);
  const plugins: RootEntry[] =
    pluginOverride !== undefined
      ? pluginOverride.map((directory) => ({ directory, source: "user" as const }))
      : [
          ...(projectAllowed
            ? [{ directory: join(cwd, ".tidesurf", "plugins"), source: "project" as const }]
            : []),
          { directory: join(home, ".tidesurf", "plugins"), source: "user" as const },
        ];
  const skills: RootEntry[] =
    skillOverride !== undefined
      ? skillOverride.map((directory) => ({ directory, source: "user" as const }))
      : [
          ...(projectAllowed
            ? [
                { directory: join(cwd, ".agents", "skills"), source: "project" as const },
                { directory: join(cwd, ".tidesurf", "skills"), source: "project" as const },
              ]
            : []),
          { directory: join(home, ".agents", "skills"), source: "user" as const },
          { directory: join(home, ".tidesurf", "skills"), source: "user" as const },
        ];
  return { plugins, skills };
}

export function resolveExtensionRoots(options?: {
  cwd?: string;
  home?: string;
  env?: Record<string, string | undefined>;
}): ExtensionRoots {
  const roots = computeRoots(options ?? {});
  return {
    pluginsDirs: roots.plugins.map((root) => root.directory),
    skillsDirs: roots.skills.map((root) => root.directory),
  };
}

function isRegularFile(path: string): boolean {
  try {
    // stat (not lstat): skills and plugins are commonly installed as
    // symlinks, the `skills` CLI's recommended install method.
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function immediateSubdirectories(root: string): string[] {
  try {
    if (!statSync(root).isDirectory()) return [];
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => {
        if (entry.name.startsWith(".")) return false;
        if (entry.isDirectory()) return true;
        if (!entry.isSymbolicLink()) return false;
        try {
          return statSync(join(root, entry.name)).isDirectory();
        } catch {
          return false;
        }
      })
      .map((entry) => join(root, entry.name))
      .sort();
  } catch {
    return [];
  }
}

export function loadExtensions(options?: {
  cwd?: string;
  home?: string;
  env?: Record<string, string | undefined>;
}): ExtensionsSnapshot {
  const roots = computeRoots(options ?? {});
  const home = options?.home ?? homedir();
  const diagnostics: string[] = [];
  const skills: SkillInfo[] = [];
  const skillOrigins = new Map<string, string>();
  const plugins: LoadedPlugin[] = [];
  const pluginOrigins = new Map<string, string>();

  const addSkill = (skill: SkillInfo): void => {
    const existing = skillOrigins.get(skill.name);
    if (existing !== undefined) {
      diagnostics.push(
        `skill "${skill.name}": duplicate skill in ${skill.directory} skipped (already loaded from ${existing})`
      );
      return;
    }
    skillOrigins.set(skill.name, skill.directory);
    skills.push(skill);
  };

  for (const root of roots.skills) {
    for (const directory of immediateSubdirectories(root.directory)) {
      if (!isRegularFile(join(directory, "SKILL.md"))) continue;
      const result = loadSkillDirectory(directory, root.source);
      for (const diagnostic of result.diagnostics) {
        diagnostics.push(
          `skill "${diagnostic.skill ?? basename(diagnostic.directory)}": ${diagnostic.message}`
        );
      }
      if (result.skill !== undefined) addSkill(result.skill);
    }
  }

  for (const root of roots.plugins) {
    for (const directory of immediateSubdirectories(root.directory)) {
      if (!isRegularFile(join(directory, "plugin.json"))) continue;
      const result = loadPlugin(directory, root.source, home);
      for (const diagnostic of result.diagnostics) {
        diagnostics.push(`plugin "${diagnostic.plugin}": ${diagnostic.message}`);
      }
      if (result.plugin === undefined) continue;
      const existing = pluginOrigins.get(result.plugin.name);
      if (existing !== undefined) {
        diagnostics.push(
          `plugin "${result.plugin.name}": duplicate plugin in ${result.plugin.directory} skipped (already loaded from ${existing})`
        );
        continue;
      }
      pluginOrigins.set(result.plugin.name, result.plugin.directory);
      plugins.push(result.plugin);
    }
  }

  for (const plugin of plugins) {
    for (const skill of plugin.skills) {
      addSkill(skill);
    }
  }

  return { plugins, skills, diagnostics };
}

export function findSkill(snapshot: ExtensionsSnapshot, name: string): SkillInfo | undefined {
  return snapshot.skills.find((skill) => skill.name === name);
}

export function skillCatalog(
  skills: readonly SkillInfo[]
): readonly { name: string; description: string; source: string; plugin?: string }[] {
  return skills.map((skill) => ({
    name: skill.name,
    description: skill.description,
    source: skill.source,
    ...(skill.plugin === undefined ? {} : { plugin: skill.plugin }),
  }));
}
