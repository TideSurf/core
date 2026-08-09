import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import {
  extensionsPolicyFromEnv,
  findSkill,
  loadExtensions,
  resolveExtensionRoots,
  skillCatalog,
} from "../../src/extensions/discover.js";

const CANONICAL_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";

let tempDirs: string[] = [];

function makeTemp(): string {
  const dir = mkdtempSync(join(tmpdir(), "tidesurf-discover-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

function makeTree(): { cwd: string; home: string } {
  const root = makeTemp();
  const cwd = join(root, "cwd");
  const home = join(root, "home");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(home, { recursive: true });
  return { cwd, home };
}

function writeSkill(dir: string, name: string, description = `${name} description`): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), ["---", `name: ${name}`, `description: ${description}`, "---", `# ${name}\n`].join("\n"));
}

function writePlugin(dir: string, name: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "plugin.json"), JSON.stringify({ $schema: CANONICAL_SCHEMA, name }));
}

describe("resolveExtensionRoots", () => {
  it("returns the default project and user roots", () => {
    const { cwd, home } = makeTree();
    const roots = resolveExtensionRoots({ cwd, home, env: {} });
    expect(roots.pluginsDirs).toEqual([
      join(cwd, ".tidesurf", "plugins"),
      join(home, ".tidesurf", "plugins"),
    ]);
    expect(roots.skillsDirs).toEqual([
      join(cwd, ".agents", "skills"),
      join(cwd, ".tidesurf", "skills"),
      join(home, ".agents", "skills"),
      join(home, ".tidesurf", "skills"),
    ]);
  });

  it("replaces the defaults with env overrides, resolving entries to absolute paths in order", () => {
    const { cwd, home } = makeTree();
    const absolute = join(makeTemp(), "skills-b");
    const roots = resolveExtensionRoots({
      cwd,
      home,
      env: {
        TIDESURF_SKILLS_DIR: `relative-skills${delimiter}${absolute}`,
        TIDESURF_PLUGINS_DIR: absolute,
      },
    });
    expect(roots.skillsDirs).toEqual([join(cwd, "relative-skills"), absolute]);
    expect(roots.pluginsDirs).toEqual([absolute]);
  });

  it("applies the user policy by dropping project roots while keeping env overrides", () => {
    const { cwd, home } = makeTree();
    const override = join(makeTemp(), "override-skills");
    const userRoots = resolveExtensionRoots({ cwd, home, env: { TIDESURF_EXTENSIONS: "user" } });
    expect(userRoots.pluginsDirs).toEqual([join(home, ".tidesurf", "plugins")]);
    expect(userRoots.skillsDirs).toEqual([
      join(home, ".agents", "skills"),
      join(home, ".tidesurf", "skills"),
    ]);
    const overridden = resolveExtensionRoots({
      cwd,
      home,
      env: { TIDESURF_EXTENSIONS: "user", TIDESURF_SKILLS_DIR: override },
    });
    expect(overridden.skillsDirs).toEqual([override]);
  });

  it("returns no roots at all under the off policy", () => {
    const { cwd, home } = makeTree();
    const roots = resolveExtensionRoots({ cwd, home, env: { TIDESURF_EXTENSIONS: "off" } });
    expect(roots.pluginsDirs).toEqual([]);
    expect(roots.skillsDirs).toEqual([]);
  });
});

describe("extensionsPolicyFromEnv", () => {
  it("maps the env var, defaulting and falling back to all", () => {
    expect(extensionsPolicyFromEnv({})).toBe("all");
    expect(extensionsPolicyFromEnv({ TIDESURF_EXTENSIONS: "all" })).toBe("all");
    expect(extensionsPolicyFromEnv({ TIDESURF_EXTENSIONS: "user" })).toBe("user");
    expect(extensionsPolicyFromEnv({ TIDESURF_EXTENSIONS: "off" })).toBe("off");
    expect(extensionsPolicyFromEnv({ TIDESURF_EXTENSIONS: "bogus" })).toBe("all");
  });
});

describe("loadExtensions", () => {
  it("loads standalone skills from every root in order with source attribution", () => {
    const { cwd, home } = makeTree();
    writeSkill(join(cwd, ".agents", "skills", "alpha"), "alpha");
    writeSkill(join(home, ".tidesurf", "skills", "beta"), "beta");
    const snapshot = loadExtensions({ cwd, home, env: {} });
    expect(snapshot.skills.map((skill) => skill.name)).toEqual(["alpha", "beta"]);
    expect(snapshot.skills[0].source).toBe("project");
    expect(snapshot.skills[1].source).toBe("user");
    expect(snapshot.plugins).toEqual([]);
    expect(snapshot.diagnostics).toEqual([]);
  });

  it("skips project-scoped dirs under the user policy and everything under off", () => {
    const { cwd, home } = makeTree();
    writeSkill(join(cwd, ".agents", "skills", "alpha"), "alpha");
    writeSkill(join(home, ".agents", "skills", "beta"), "beta");
    writePlugin(join(cwd, ".tidesurf", "plugins", "proj-plugin"), "proj-plugin");
    writePlugin(join(home, ".tidesurf", "plugins", "user-plugin"), "user-plugin");

    const userSnapshot = loadExtensions({ cwd, home, env: { TIDESURF_EXTENSIONS: "user" } });
    expect(userSnapshot.skills.map((skill) => skill.name)).toEqual(["beta"]);
    expect(userSnapshot.plugins.map((plugin) => plugin.name)).toEqual(["user-plugin"]);

    const offSnapshot = loadExtensions({ cwd, home, env: { TIDESURF_EXTENSIONS: "off" } });
    expect(offSnapshot.skills).toEqual([]);
    expect(offSnapshot.plugins).toEqual([]);
    expect(offSnapshot.diagnostics).toEqual([]);
  });

  it("honors env overrides during loading", () => {
    const { cwd, home } = makeTree();
    const custom = join(makeTemp(), "custom-skills");
    writeSkill(join(custom, "custom"), "custom");
    writeSkill(join(cwd, ".agents", "skills", "alpha"), "alpha");
    const snapshot = loadExtensions({ cwd, home, env: { TIDESURF_SKILLS_DIR: custom } });
    expect(snapshot.skills.map((skill) => skill.name)).toEqual(["custom"]);
    expect(snapshot.skills[0].source).toBe("user");
  });

  it("deduplicates skill names with project beating user", () => {
    const { cwd, home } = makeTree();
    writeSkill(join(cwd, ".agents", "skills", "dup"), "dup", "project copy");
    writeSkill(join(home, ".agents", "skills", "dup"), "dup", "user copy");
    const snapshot = loadExtensions({ cwd, home, env: {} });
    expect(snapshot.skills).toHaveLength(1);
    expect(snapshot.skills[0].description).toBe("project copy");
    expect(snapshot.skills[0].source).toBe("project");
    expect(snapshot.diagnostics.some((d) => d.includes('skill "dup": duplicate'))).toBe(true);
  });

  it("loads plugins and exposes their skills with the plugin field set", () => {
    const { cwd, home } = makeTree();
    writeSkill(join(cwd, ".agents", "skills", "standalone"), "standalone");
    const pluginDir = join(cwd, ".tidesurf", "plugins", "plug");
    writePlugin(pluginDir, "plug");
    writeSkill(join(pluginDir, "skills", "plug-skill"), "plug-skill");
    const snapshot = loadExtensions({ cwd, home, env: {} });
    expect(snapshot.plugins).toHaveLength(1);
    expect(snapshot.plugins[0].name).toBe("plug");
    expect(snapshot.skills.map((skill) => skill.name)).toEqual(["standalone", "plug-skill"]);
    const pluginSkill = findSkill(snapshot, "plug-skill");
    expect(pluginSkill?.plugin).toBe("plug");
    expect(pluginSkill?.source).toBe("project");
  });

  it("deduplicates plugin names with first winning and drops its skills", () => {
    const { cwd, home } = makeTree();
    const projectPlugin = join(cwd, ".tidesurf", "plugins", "plug");
    const userPlugin = join(home, ".tidesurf", "plugins", "plug");
    writePlugin(projectPlugin, "plug");
    writePlugin(userPlugin, "plug");
    writeSkill(join(projectPlugin, "skills", "proj-skill"), "proj-skill");
    writeSkill(join(userPlugin, "skills", "user-skill"), "user-skill");
    const snapshot = loadExtensions({ cwd, home, env: {} });
    expect(snapshot.plugins).toHaveLength(1);
    expect(snapshot.plugins[0].directory).toBe(projectPlugin);
    expect(snapshot.skills.map((skill) => skill.name)).toEqual(["proj-skill"]);
    expect(snapshot.diagnostics.some((d) => d.includes('plugin "plug": duplicate'))).toBe(true);
  });

  it("lets a standalone skill win over a plugin skill with the same name", () => {
    const { cwd, home } = makeTree();
    writeSkill(join(cwd, ".agents", "skills", "shared"), "shared", "standalone copy");
    const pluginDir = join(cwd, ".tidesurf", "plugins", "plug");
    writePlugin(pluginDir, "plug");
    writeSkill(join(pluginDir, "skills", "shared-dir"), "shared", "plugin copy");
    const snapshot = loadExtensions({ cwd, home, env: {} });
    expect(snapshot.skills).toHaveLength(1);
    expect(snapshot.skills[0].description).toBe("standalone copy");
    expect(snapshot.diagnostics.some((d) => d.includes('skill "shared": duplicate'))).toBe(true);
  });

  it("does not load a SKILL.md sitting directly at a skills root", () => {
    const { cwd, home } = makeTree();
    const root = join(cwd, ".agents", "skills");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "SKILL.md"), "---\nname: root-skill\ndescription: Root\n---\n# root\n");
    const snapshot = loadExtensions({ cwd, home, env: {} });
    expect(snapshot.skills).toEqual([]);
  });

  it("ignores non-directory roots silently", () => {
    const { cwd, home } = makeTree();
    mkdirSync(join(cwd, ".agents"), { recursive: true });
    writeFileSync(join(cwd, ".agents", "skills"), "not a directory");
    const snapshot = loadExtensions({ cwd, home, env: {} });
    expect(snapshot.skills).toEqual([]);
    expect(snapshot.plugins).toEqual([]);
    expect(snapshot.diagnostics).toEqual([]);
  });

  it("flattens skill and plugin diagnostics into prefixed strings", () => {
    const { cwd, home } = makeTree();
    const badSkill = join(cwd, ".agents", "skills", "baddesc");
    mkdirSync(badSkill, { recursive: true });
    writeFileSync(join(badSkill, "SKILL.md"), "---\nname: baddesc\n---\n# body\n");
    writePlugin(join(home, ".tidesurf", "plugins", "noschema"), "noschema");
    writeFileSync(
      join(home, ".tidesurf", "plugins", "noschema", "plugin.json"),
      JSON.stringify({ name: "noschema" })
    );
    const snapshot = loadExtensions({ cwd, home, env: {} });
    expect(
      snapshot.diagnostics.some(
        (d) => d.startsWith('skill "baddesc":') && d.includes("description")
      )
    ).toBe(true);
    expect(
      snapshot.diagnostics.some((d) => d.startsWith('plugin "noschema":') && d.includes("$schema"))
    ).toBe(true);
  });
});

describe("findSkill and skillCatalog", () => {
  it("finds skills by name and builds the catalog", () => {
    const { cwd, home } = makeTree();
    writeSkill(join(cwd, ".agents", "skills", "alpha"), "alpha");
    const pluginDir = join(cwd, ".tidesurf", "plugins", "plug");
    writePlugin(pluginDir, "plug");
    writeSkill(join(pluginDir, "skills", "plug-skill"), "plug-skill");
    const snapshot = loadExtensions({ cwd, home, env: {} });

    expect(findSkill(snapshot, "alpha")?.name).toBe("alpha");
    expect(findSkill(snapshot, "missing")).toBeUndefined();

    expect(skillCatalog(snapshot.skills)).toEqual([
      { name: "alpha", description: "alpha description", source: "project" },
      { name: "plug-skill", description: "plug-skill description", source: "project", plugin: "plug" },
    ]);
  });

  it("discovers skills installed as symlinked directories", () => {
    const { cwd, home } = makeTree();
    const store = join(cwd, "skill-store");
    writeSkill(join(store, "linked-skill"), "linked-skill");
    mkdirSync(join(cwd, ".agents", "skills"), { recursive: true });
    symlinkSync(
      join(store, "linked-skill"),
      join(cwd, ".agents", "skills", "linked-skill"),
      "dir"
    );
    const snapshot = loadExtensions({ cwd, home, env: {} });
    expect(snapshot.skills.map((skill) => skill.name)).toContain("linked-skill");
  });
});
