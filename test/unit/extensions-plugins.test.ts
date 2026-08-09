import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import {
  loadPlugin,
  pluginDataDirectory,
  validatePluginName,
} from "../../src/extensions/plugins.js";
import { loadSkillDocument } from "../../src/extensions/skills.js";

const PLUGIN_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const MCP_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";
const CONFIG_LIMIT = 1024 * 1024;
const SERVER_LIMIT = 128;

let tempDirs: string[] = [];

function makeTemp(): string {
  const dir = mkdtempSync(join(tmpdir(), "tidesurf-plugins-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

function manifest(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { $schema: PLUGIN_SCHEMA, name: "my-plugin", ...extra };
}

function mcpDocument(
  servers: Record<string, unknown> = {},
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return { $schema: MCP_SCHEMA, mcpServers: servers, ...extra };
}

function writeDocument(path: string, doc: unknown): void {
  writeFileSync(path, typeof doc === "string" ? doc : JSON.stringify(doc));
}

function writePlugin(dir: string, doc: unknown = manifest(), mcp?: unknown): void {
  mkdirSync(dir, { recursive: true });
  writeDocument(join(dir, "plugin.json"), doc);
  if (mcp !== undefined) writeDocument(join(dir, "mcp.json"), mcp);
}

function writeSkill(dir: string, name: string, description?: string): void {
  mkdirSync(dir, { recursive: true });
  const fields = [`name: ${name}`];
  if (description !== undefined) fields.push(`description: ${description}`);
  writeFileSync(join(dir, "SKILL.md"), ["---", ...fields, "---", "# body", ""].join("\n"));
}

function loadServers(
  servers: Record<string, unknown>,
  options: { home?: string; prepare?: (dir: string, home: string) => void } = {}
) {
  const home = options.home ?? makeTemp();
  const dir = join(makeTemp(), "my-plugin");
  writePlugin(dir, manifest(), mcpDocument(servers));
  options.prepare?.(dir, home);
  return loadPlugin(dir, "user", home);
}

describe("validatePluginName", () => {
  it("accepts every canonical name shape", () => {
    for (const name of ["a", "my-plugin", "a.b", "a1", "x".repeat(64)]) {
      expect(validatePluginName(name)).toBeUndefined();
    }
  });

  it("rejects invalid types and canonical name violations", () => {
    for (const name of [
      1,
      null,
      "",
      "A",
      "a..b",
      "a--b",
      "-a",
      "a-",
      ".a",
      "a.",
      "a_b",
      "x".repeat(65),
    ]) {
      expect(validatePluginName(name)).toBeTypeOf("string");
    }
  });
});

describe("pluginDataDirectory", () => {
  it("keeps the legacy two-string call as a canonical user-scoped path", () => {
    const home = makeTemp();
    const expected = join(
      realpathSync(home),
      ".tidesurf",
      "plugin-data",
      "user",
      "my-plugin"
    );
    expect(pluginDataDirectory(home, "my-plugin")).toBe(expected);
    expect(isAbsolute(pluginDataDirectory(home, "my-plugin"))).toBe(true);
  });

  it("scopes LoadedPlugin data by user or canonical project identity", () => {
    const home = makeTemp();
    const userDir = join(makeTemp(), "my-plugin");
    writePlugin(userDir);
    const user = loadPlugin(userDir, "user", home).plugin!;
    expect(user.dataDirectory).toBe(pluginDataDirectory(home, "my-plugin"));

    const project = makeTemp();
    const projectDir = join(project, ".tidesurf", "plugins", "my-plugin");
    writePlugin(projectDir);
    const loaded = loadPlugin(projectDir, "project", home).plugin!;
    const projectId = createHash("sha256")
      .update(realpathSync(project))
      .digest("hex")
      .slice(0, 16);
    expect(loaded.dataDirectory).toBe(
      join(
        realpathSync(home),
        ".tidesurf",
        "plugin-data",
        "project",
        projectId,
        "my-plugin"
      )
    );
    expect(loaded.dataDirectory).not.toBe(user.dataDirectory);
  });

  it("isolates equal project plugin names across canonical roots", () => {
    const home = makeTemp();
    const projects = [makeTemp(), makeTemp()];
    const dataDirectories = projects.map((project) => {
      const directory = join(project, ".tidesurf", "plugins", "my-plugin");
      writePlugin(directory);
      return loadPlugin(directory, "project", home).plugin!.dataDirectory;
    });
    expect(dataDirectories[0]).not.toBe(dataDirectories[1]);
  });

  it("hashes the canonical project root rather than a symlink alias", () => {
    const home = makeTemp();
    const project = makeTemp();
    const directory = join(project, ".tidesurf", "plugins", "my-plugin");
    writePlugin(directory);
    const alias = join(makeTemp(), "project-alias");
    symlinkSync(project, alias, "dir");

    const direct = loadPlugin(directory, "project", home).plugin!;
    const throughAlias = loadPlugin(
      join(alias, ".tidesurf", "plugins", "my-plugin"),
      "project",
      home
    ).plugin!;
    expect(throughAlias.dataDirectory).toBe(direct.dataDirectory);
  });
});

describe("plugin.json conformance", () => {
  it("loads a minimal manifest from its filesystem-resolved plugin root", () => {
    const home = makeTemp();
    const actual = join(makeTemp(), "actual-plugin");
    writePlugin(actual);
    const link = join(makeTemp(), "linked-plugin");
    symlinkSync(actual, link, "dir");

    const { plugin, diagnostics } = loadPlugin(link, "project", home);
    expect(diagnostics).toEqual([]);
    expect(plugin?.name).toBe("my-plugin");
    expect(plugin?.source).toBe("project");
    expect(plugin?.directory).toBe(realpathSync(actual));
    expect(plugin?.manifest).toEqual({ name: "my-plugin" });
    expect(plugin?.skills).toEqual([]);
    expect(plugin?.mcpServers).toEqual([]);
    expect(plugin?.mcpDisabled).toBeUndefined();
  });

  it("preserves valid metadata and does not validate unimplemented extension namespaces", () => {
    const dir = join(makeTemp(), "my-plugin");
    writePlugin(
      dir,
      manifest({
        version: "not-required-to-be-semver",
        description: "A plugin",
        author: { name: "Team", email: "not-required-to-be-an-email", url: "not-a-url" },
        homepage: "not-a-url",
        repository: "repo",
        license: "custom-license",
        keywords: ["a", "b"],
        extensions: {
          "com.example.unimplemented": 42,
          "org.example.other": ["contents", "are", "opaque"],
        },
      })
    );

    const { plugin, diagnostics } = loadPlugin(dir, "user", makeTemp());
    expect(diagnostics).toEqual([]);
    expect(plugin?.manifest.version).toBe("not-required-to-be-semver");
    expect(plugin?.manifest.author).toEqual({
      name: "Team",
      email: "not-required-to-be-an-email",
      url: "not-a-url",
    });
    expect(plugin?.manifest.keywords).toEqual(["a", "b"]);
    expect(plugin?.manifest.extensions).toEqual({
      "com.example.unimplemented": 42,
      "org.example.other": ["contents", "are", "opaque"],
    });
  });

  it("requires the exact supported canonical plugin schema", () => {
    for (const doc of [
      { name: "my-plugin" },
      { $schema: 1, name: "my-plugin" },
      { $schema: "https://example.com/plugin.schema.json", name: "my-plugin" },
      {
        $schema: "https://agent-plugins.org/schemas/1.0.1/plugin.schema.json",
        name: "my-plugin",
      },
    ]) {
      const dir = join(makeTemp(), "fixture");
      writePlugin(dir, doc);
      const { plugin, diagnostics } = loadPlugin(dir, "project", makeTemp());
      expect(plugin).toBeUndefined();
      expect(diagnostics.some((diagnostic) => diagnostic.message.includes("unsupported $schema"))).toBe(
        true
      );
    }
  });

  it("reports and ignores unknown top-level fields without assigning semantics", () => {
    const dir = join(makeTemp(), "my-plugin");
    writePlugin(dir, manifest({ typo: true, mcpServers: { inline: {} } }));
    const { plugin, diagnostics } = loadPlugin(dir, "project", makeTemp());

    expect(plugin).toBeDefined();
    expect(plugin?.mcpServers).toEqual([]);
    expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      'unknown top-level field "typo" ignored',
      'unknown top-level field "mcpServers" ignored',
    ]);
    expect("typo" in (plugin?.manifest ?? {})).toBe(false);
  });

  it("reports and drops non-object extensions without rejecting the plugin", () => {
    for (const extensions of [null, [1], "bad", 1, true]) {
      const dir = join(makeTemp(), "fixture");
      writePlugin(dir, manifest({ extensions }));
      const { plugin, diagnostics } = loadPlugin(dir, "project", makeTemp());
      expect(plugin).toBeDefined();
      expect(plugin?.manifest.extensions).toBeUndefined();
      expect(diagnostics.some((diagnostic) => diagnostic.message.includes("field ignored"))).toBe(true);
    }
  });

  it("rejects unknown author fields and every other known-field schema violation", () => {
    const cases: Record<string, unknown>[] = [
      { name: "A" },
      { version: 1 },
      { description: {} },
      { homepage: true },
      { repository: [] },
      { license: null },
      { author: "Team" },
      { author: { name: 1 } },
      { author: { name: "Team", organization: "Acme" } },
      { keywords: "not-an-array" },
      { keywords: ["a", 1] },
    ];
    for (const extra of cases) {
      const dir = join(makeTemp(), "fixture");
      writePlugin(dir, manifest(extra));
      const { plugin, diagnostics } = loadPlugin(dir, "project", makeTemp());
      expect(plugin).toBeUndefined();
      expect(diagnostics.length).toBeGreaterThan(0);
    }
  });

  it("rejects missing, invalid, non-object, and wrong-kind manifests", () => {
    const missing = join(makeTemp(), "missing");
    mkdirSync(missing, { recursive: true });
    expect(loadPlugin(missing, "project", makeTemp()).plugin).toBeUndefined();

    const invalid = join(makeTemp(), "invalid");
    writePlugin(invalid, "{not json");
    expect(loadPlugin(invalid, "project", makeTemp()).plugin).toBeUndefined();

    const array = join(makeTemp(), "array");
    writePlugin(array, [1, 2]);
    expect(loadPlugin(array, "project", makeTemp()).plugin).toBeUndefined();

    const directoryManifest = join(makeTemp(), "directory-manifest");
    mkdirSync(join(directoryManifest, "plugin.json"), { recursive: true });
    const result = loadPlugin(directoryManifest, "project", makeTemp());
    expect(result.plugin).toBeUndefined();
    expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes("regular file"))).toBe(true);
  });

  it("rejects plugin.json when its filesystem path escapes the canonical plugin root", () => {
    const outside = join(makeTemp(), "outside-plugin.json");
    writeDocument(outside, manifest());
    const dir = join(makeTemp(), "my-plugin");
    mkdirSync(dir, { recursive: true });
    symlinkSync(outside, join(dir, "plugin.json"), "file");

    const { plugin, diagnostics } = loadPlugin(dir, "project", makeTemp());
    expect(plugin).toBeUndefined();
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes("outside the plugin root"))).toBe(
      true
    );
  });

  it("allows plugin.json to resolve through a symlink that stays inside the plugin root", () => {
    const dir = join(makeTemp(), "my-plugin");
    mkdirSync(join(dir, "config"), { recursive: true });
    writeDocument(join(dir, "config", "manifest.json"), manifest());
    symlinkSync(join(dir, "config", "manifest.json"), join(dir, "plugin.json"), "file");

    const { plugin, diagnostics } = loadPlugin(dir, "project", makeTemp());
    expect(plugin).toBeDefined();
    expect(diagnostics).toEqual([]);
  });

  it("bounds plugin.json to one MiB before decoding", () => {
    const dir = join(makeTemp(), "my-plugin");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "plugin.json"), Buffer.alloc(CONFIG_LIMIT + 1, 0x20));

    const { plugin, diagnostics } = loadPlugin(dir, "project", makeTemp());
    expect(plugin).toBeUndefined();
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes(`${CONFIG_LIMIT}-byte limit`))).toBe(
      true
    );
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes("not valid JSON"))).toBe(false);
  });
});

describe("skills fixed-location and per-skill boundaries", () => {
  it("carries the canonical plugin root into activation and rejects a swapped skill directory", () => {
    const dir = join(makeTemp(), "my-plugin");
    writePlugin(dir);
    const skillDirectory = join(dir, "skills", "guarded");
    writeSkill(skillDirectory, "guarded", "Guarded");

    const { plugin, diagnostics } = loadPlugin(dir, "user", makeTemp());
    expect(diagnostics).toEqual([]);
    const skill = plugin?.skills[0];
    expect(skill?.pluginRoot).toBe(realpathSync(dir));

    const outside = join(makeTemp(), "guarded");
    writeSkill(outside, "guarded", "Guarded");
    rmSync(skillDirectory, { recursive: true, force: true });
    symlinkSync(outside, skillDirectory, "dir");

    expect(() => loadSkillDocument(skill!)).toThrow(/outside the plugin root/);
  });

  it("loads only immediate valid skills and isolates an invalid sibling", () => {
    const dir = join(makeTemp(), "my-plugin");
    writePlugin(dir);
    writeSkill(join(dir, "skills", "good"), "good", "Good skill");
    writeSkill(join(dir, "skills", "bad"), "bad");
    writeSkill(join(dir, "skills", "nested", "too-deep"), "too-deep", "Too deep");

    const { plugin, diagnostics } = loadPlugin(dir, "user", makeTemp());
    expect(plugin?.skills.map((skill) => skill.name)).toEqual(["good"]);
    expect(plugin?.skills[0].plugin).toBe("my-plugin");
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes('skill "bad"'))).toBe(true);
  });

  it("invalidates only skills when the fixed skills location escapes or has the wrong kind", () => {
    const outsideSkills = join(makeTemp(), "outside-skills");
    writeSkill(join(outsideSkills, "external"), "external", "External");
    const escaped = join(makeTemp(), "escaped-plugin");
    writePlugin(
      escaped,
      manifest(),
      mcpDocument({ good: { type: "stdio", command: "node" } })
    );
    symlinkSync(outsideSkills, join(escaped, "skills"), "dir");

    const escapedResult = loadPlugin(escaped, "project", makeTemp());
    expect(escapedResult.plugin).toBeDefined();
    expect(escapedResult.plugin?.skills).toEqual([]);
    expect(escapedResult.plugin?.mcpServers.map((server) => server.name)).toEqual(["good"]);
    expect(
      escapedResult.diagnostics.some(
        (diagnostic) =>
          diagnostic.message.includes("skills fixed location") &&
          diagnostic.message.includes("outside the plugin root")
      )
    ).toBe(true);

    const wrongKind = join(makeTemp(), "wrong-kind-plugin");
    writePlugin(wrongKind);
    writeFileSync(join(wrongKind, "skills"), "not a directory");
    const wrongKindResult = loadPlugin(wrongKind, "project", makeTemp());
    expect(wrongKindResult.plugin).toBeDefined();
    expect(wrongKindResult.plugin?.skills).toEqual([]);
    expect(wrongKindResult.diagnostics.some((diagnostic) => diagnostic.message.includes("directory"))).toBe(
      true
    );
  });

  it("skips only a skill whose directory or SKILL.md escapes the plugin root", () => {
    const dir = join(makeTemp(), "my-plugin");
    writePlugin(dir);
    writeSkill(join(dir, "skills", "good"), "good", "Good");

    const externalSkill = join(makeTemp(), "external-skill");
    writeSkill(externalSkill, "linked-dir", "External directory");
    symlinkSync(externalSkill, join(dir, "skills", "linked-dir"), "dir");

    const externalSkillMd = join(makeTemp(), "external-SKILL.md");
    writeFileSync(externalSkillMd, "---\nname: linked-file\ndescription: External file\n---\n# body\n");
    mkdirSync(join(dir, "skills", "linked-file"), { recursive: true });
    symlinkSync(externalSkillMd, join(dir, "skills", "linked-file", "SKILL.md"), "file");

    const { plugin, diagnostics } = loadPlugin(dir, "project", makeTemp());
    expect(plugin?.skills.map((skill) => skill.name)).toEqual(["good"]);
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes('skill "linked-dir"'))).toBe(
      true
    );
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes('skill "linked-file"'))).toBe(
      true
    );
    expect(diagnostics.filter((diagnostic) => diagnostic.message.includes("outside the plugin root"))).toHaveLength(
      2
    );
  });
});

describe("mcp.json top-level conformance", () => {
  it("treats a missing mcp.json as an absent optional component", () => {
    const dir = join(makeTemp(), "my-plugin");
    writePlugin(dir);
    const { plugin, diagnostics } = loadPlugin(dir, "user", makeTemp());
    expect(plugin?.mcpServers).toEqual([]);
    expect(plugin?.mcpDisabled).toBeUndefined();
    expect(diagnostics).toEqual([]);
  });

  it("requires the exact canonical MCP schema and closed top-level object", () => {
    const cases: unknown[] = [
      { mcpServers: {} },
      { $schema: 1, mcpServers: {} },
      { $schema: "https://agent-plugins.org/schemas/1.0.1/mcp.schema.json", mcpServers: {} },
      { $schema: MCP_SCHEMA, mcpServers: {}, extra: true },
      { $schema: MCP_SCHEMA },
      { $schema: MCP_SCHEMA, mcpServers: [] },
      [],
      "{broken",
    ];
    for (const mcp of cases) {
      const dir = join(makeTemp(), "my-plugin");
      writePlugin(dir, manifest(), mcp);
      const { plugin, diagnostics } = loadPlugin(dir, "user", makeTemp());
      expect(plugin).toBeDefined();
      expect(plugin?.mcpServers).toEqual([]);
      expect(plugin?.mcpDisabled).toBeTypeOf("string");
      expect(diagnostics.length).toBeGreaterThan(0);
    }
  });

  it("invalidates only MCP when mcp.json escapes, while skills still load", () => {
    const outsideMcp = join(makeTemp(), "outside-mcp.json");
    writeDocument(outsideMcp, mcpDocument({ escaped: { type: "stdio", command: "node" } }));
    const dir = join(makeTemp(), "my-plugin");
    writePlugin(dir);
    writeSkill(join(dir, "skills", "good"), "good", "Good");
    symlinkSync(outsideMcp, join(dir, "mcp.json"), "file");

    const { plugin, diagnostics } = loadPlugin(dir, "project", makeTemp());
    expect(plugin).toBeDefined();
    expect(plugin?.skills.map((skill) => skill.name)).toEqual(["good"]);
    expect(plugin?.mcpServers).toEqual([]);
    expect(plugin?.mcpDisabled).toContain("outside the plugin root");
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes("mcp.json"))).toBe(true);
  });

  it("allows mcp.json to resolve inside the root and rejects the wrong filesystem kind", () => {
    const inside = join(makeTemp(), "inside-plugin");
    writePlugin(inside);
    mkdirSync(join(inside, "config"), { recursive: true });
    writeDocument(
      join(inside, "config", "mcp-config.json"),
      mcpDocument({ good: { type: "stdio", command: "node" } })
    );
    symlinkSync(join(inside, "config", "mcp-config.json"), join(inside, "mcp.json"), "file");
    expect(loadPlugin(inside, "project", makeTemp()).plugin?.mcpServers).toHaveLength(1);

    const wrongKind = join(makeTemp(), "wrong-kind-plugin");
    writePlugin(wrongKind);
    mkdirSync(join(wrongKind, "mcp.json"));
    const result = loadPlugin(wrongKind, "project", makeTemp());
    expect(result.plugin).toBeDefined();
    expect(result.plugin?.mcpDisabled).toContain("regular file");
  });

  it("bounds mcp.json to one MiB before decoding", () => {
    const dir = join(makeTemp(), "my-plugin");
    writePlugin(dir);
    writeFileSync(join(dir, "mcp.json"), Buffer.alloc(CONFIG_LIMIT + 1, 0x20));

    const { plugin, diagnostics } = loadPlugin(dir, "project", makeTemp());
    expect(plugin).toBeDefined();
    expect(plugin?.mcpDisabled).toContain(`${CONFIG_LIMIT}-byte limit`);
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes("not valid JSON"))).toBe(false);
  });

  it("caps the number of MCP entries without disabling valid entries", () => {
    const servers: Record<string, unknown> = {};
    for (let index = 0; index < SERVER_LIMIT + 3; index++) {
      servers[`server-${String(index).padStart(3, "0")}`] = { type: "stdio", command: "node" };
    }
    const { plugin, diagnostics } = loadServers(servers);
    expect(plugin?.mcpDisabled).toBeUndefined();
    expect(plugin?.mcpServers).toHaveLength(SERVER_LIMIT);
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes(`first ${SERVER_LIMIT}`))).toBe(
      true
    );
  });
});

describe("MCP server schema and stdio semantics", () => {
  it("expands known placeholders once and preserves unknown placeholder-like text literally", () => {
    const home = join(makeTemp(), "home-${PLUGIN_ROOT}");
    mkdirSync(home, { recursive: true });
    const { plugin, diagnostics } = loadServers(
      {
        server: {
          type: "stdio",
          command: "node",
          args: ["${PLUGIN_ROOT}/server.js", "${UNKNOWN}", "$HOME"],
          env: {
            DATA: "${PLUGIN_DATA}",
            MIXED: "${PLUGIN_ROOT}/${UNKNOWN}",
          },
          cwd: "${PLUGIN_ROOT}",
        },
      },
      { home }
    );

    const server = plugin?.mcpServers[0];
    expect(diagnostics).toEqual([]);
    expect(server?.args).toEqual([
      `${plugin?.directory}/server.js`,
      "${UNKNOWN}",
      "$HOME",
    ]);
    expect(server?.env?.DATA).toBe(plugin?.dataDirectory);
    expect(server?.env?.DATA).toContain("${PLUGIN_ROOT}");
    expect(server?.env?.MIXED).toBe(`${plugin?.directory}/${"${UNKNOWN}"}`);
    expect(server?.cwd).toBe(plugin?.directory);
  });

  it("resolves ./ commands against the plugin root independently of cwd", () => {
    const home = makeTemp();
    const { plugin, diagnostics } = loadServers(
      {
        bundled: {
          type: "stdio",
          command: "./bin/run",
          cwd: "${PLUGIN_DATA}",
        },
      },
      { home }
    );

    expect(diagnostics).toEqual([]);
    expect(plugin?.mcpServers[0].command).toBe(join(plugin!.directory, "bin", "run"));
    expect(plugin?.mcpServers[0].cwd).toBe(plugin?.dataDirectory);
  });

  it("accepts literal no-shell executable tokens and ./ paths with filename characters", () => {
    const bareCommands = [
      "node",
      "node server.js",
      "run()$[]{}!#",
      "semi;and&&pipe|redirect<>`quoted`",
      " leading and trailing ",
      "~runner",
    ];
    const servers = Object.fromEntries([
      ...bareCommands.map((command, index) => [
        `bare-${index}`,
        { type: "stdio", command },
      ]),
      ["relative", { type: "stdio", command: "./bin/run ()$[]{}!#" }],
    ]);

    const { plugin, diagnostics } = loadServers(servers);
    expect(diagnostics).toEqual([]);
    expect(plugin?.mcpServers.slice(0, bareCommands.length).map((server) => server.command)).toEqual(
      bareCommands
    );
    expect(plugin?.mcpServers.at(-1)?.command).toBe(
      join(plugin!.directory, "bin", "run ()$[]{}!#")
    );
  });

  it("rejects NUL, placeholders, absolute, non-./ relative, and traversal commands", () => {
    const commands = [
      "bad\0command",
      "/usr/bin/node",
      "C:\\bin\\node.exe",
      "C:bin\\node.exe",
      "~/bin/run",
      "foo/bar",
      "foo\\bar",
      "../bin/run",
      ".",
      "..",
      "./../bin/run",
      "./bin/../run",
      "${PLUGIN_ROOT}",
      "run-${PLUGIN_DATA}",
      "./${PLUGIN_ROOT}/run",
    ];
    const servers: Record<string, unknown> = {
      good: { type: "stdio", command: "node" },
    };
    commands.forEach((command, index) => {
      servers[`bad-${index}`] = { type: "stdio", command };
    });

    const { plugin, diagnostics } = loadServers(servers);
    expect(plugin?.mcpServers.map((server) => server.name)).toEqual(["good"]);
    expect(diagnostics.filter((diagnostic) => diagnostic.message.includes("command"))).toHaveLength(
      commands.length
    );
  });

  it("rejects a ./ command whose symlink resolution escapes the plugin root", () => {
    const outside = makeTemp();
    writeFileSync(join(outside, "run"), "#!/bin/sh\n");
    const { plugin, diagnostics } = loadServers(
      {
        escaped: { type: "stdio", command: "./outside/run" },
        good: { type: "stdio", command: "node" },
      },
      {
        prepare: (dir) => symlinkSync(outside, join(dir, "outside"), "dir"),
      }
    );

    expect(plugin?.mcpServers.map((server) => server.name)).toEqual(["good"]);
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes("outside the plugin root"))).toBe(
      true
    );
  });

  it("accepts only the three canonical cwd forms and validates against the matching root", () => {
    const home = makeTemp();
    const { plugin, diagnostics } = loadServers(
      {
        relative: { type: "stdio", command: "node", cwd: "./work" },
        root: { type: "stdio", command: "node", cwd: "${PLUGIN_ROOT}/work" },
        data: { type: "stdio", command: "node", cwd: "${PLUGIN_DATA}/work" },
        literalUnknown: { type: "stdio", command: "node", cwd: "./${UNKNOWN}" },
      },
      {
        home,
        prepare: (dir) => {
          mkdirSync(join(dir, "work"), { recursive: true });
          mkdirSync(join(pluginDataDirectory(home, "my-plugin"), "work"), { recursive: true });
        },
      }
    );

    expect(diagnostics).toEqual([]);
    const byName = new Map(plugin?.mcpServers.map((server) => [server.name, server.cwd]));
    expect(byName.get("relative")).toBe(join(plugin!.directory, "work"));
    expect(byName.get("root")).toBe(join(plugin!.directory, "work"));
    expect(byName.get("data")).toBe(join(plugin!.dataDirectory!, "work"));
    expect(byName.get("literalUnknown")).toBe(join(plugin!.directory, "${UNKNOWN}"));
  });

  it("rejects bare, absolute, traversal, and symlink-escaping cwd values per server", () => {
    const home = makeTemp();
    const outside = makeTemp();
    const { plugin, diagnostics } = loadServers(
      {
        good: { type: "stdio", command: "node" },
        dot: { type: "stdio", command: "node", cwd: "." },
        bare: { type: "stdio", command: "node", cwd: "work" },
        absolute: { type: "stdio", command: "node", cwd: outside },
        rootTraversal: { type: "stdio", command: "node", cwd: "${PLUGIN_ROOT}/../escape" },
        dataTraversal: { type: "stdio", command: "node", cwd: "${PLUGIN_DATA}/../escape" },
        rootSymlink: { type: "stdio", command: "node", cwd: "./root-link" },
        dataSymlink: { type: "stdio", command: "node", cwd: "${PLUGIN_DATA}/data-link" },
      },
      {
        home,
        prepare: (dir) => {
          symlinkSync(outside, join(dir, "root-link"), "dir");
          const data = pluginDataDirectory(home, "my-plugin");
          mkdirSync(data, { recursive: true });
          symlinkSync(outside, join(data, "data-link"), "dir");
        },
      }
    );

    expect(plugin?.mcpServers.map((server) => server.name)).toEqual(["good"]);
    expect(diagnostics.filter((diagnostic) => diagnostic.message.includes("cwd"))).toHaveLength(7);
  });

  it("rejects reserved environment names with platform environment-name semantics", () => {
    const { plugin, diagnostics } = loadServers({
      root: { type: "stdio", command: "node", env: { PLUGIN_ROOT: "override" } },
      data: { type: "stdio", command: "node", env: { PLUGIN_DATA: "override" } },
      platformCase: { type: "stdio", command: "node", env: { plugin_root: "value" } },
      good: { type: "stdio", command: "node", env: { MODE: "test" } },
    });

    const expected = process.platform === "win32" ? ["good"] : ["platformCase", "good"];
    expect(plugin?.mcpServers.map((server) => server.name)).toEqual(expected);
    expect(diagnostics.filter((diagnostic) => diagnostic.message.includes("reserved key"))).toHaveLength(
      process.platform === "win32" ? 3 : 2
    );
  });

  it("applies the closed schema to each server and skips only invalid or unsupported entries", () => {
    const { plugin, diagnostics } = loadServers({
      good: { type: "stdio", command: "node" },
      "": { type: "stdio", command: "node" },
      unknownField: { type: "stdio", command: "node", note: "no" },
      stdioVariantField: { type: "stdio", command: "node", url: "https://example.com" },
      httpVariantField: {
        type: "streamable-http",
        url: "https://example.com/mcp",
        command: "node",
      },
      badArgs: { type: "stdio", command: "node", args: [1] },
      unknownType: { type: "websocket", url: "https://example.com" },
      missingType: { command: "node" },
      notObject: "node",
      legacy: { type: "sse", url: "https://example.com/sse" },
    });

    expect(plugin?.mcpServers.map((server) => server.name)).toEqual(["good", ""]);
    expect(plugin?.mcpDisabled).toBeUndefined();
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes("not allowed"))).toBe(true);
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes("unknown type"))).toBe(true);
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes("deprecated"))).toBe(true);
  });
});

describe("streamable HTTP semantics", () => {
  it("allows HTTPS and HTTP only for localhost or IP literals in loopback ranges", () => {
    const urls = [
      "https://example.com/mcp",
      "http://localhost:8080/mcp",
      "http://127.0.0.1/mcp",
      "http://127.255.10.20/mcp",
      "http://127.1/mcp",
      "http://[::1]:8080/mcp",
    ];
    const servers = Object.fromEntries(
      urls.map((url, index) => [`server-${index}`, { type: "streamable-http", url }])
    );

    const { plugin, diagnostics } = loadServers(servers);
    expect(diagnostics).toEqual([]);
    expect(plugin?.mcpServers.map((server) => server.url)).toEqual(urls);
  });

  it("rejects non-loopback HTTP and malformed remote URLs per server", () => {
    const urls = [
      "http://example.com/mcp",
      "http://128.0.0.1/mcp",
      "http://127.0.0.1.example.com/mcp",
      "http://localhost./mcp",
      "http://[::ffff:7f00:1]/mcp",
      "ftp://example.com/mcp",
      "https://user:pass@example.com/mcp",
      "https://example.com/mcp#fragment",
      "/relative/mcp",
      "not a url",
    ];
    const servers: Record<string, unknown> = {
      good: { type: "streamable-http", url: "https://example.com/mcp" },
    };
    urls.forEach((url, index) => {
      servers[`bad-${index}`] = { type: "streamable-http", url };
    });

    const { plugin, diagnostics } = loadServers(servers);
    expect(plugin?.mcpServers.map((server) => server.name)).toEqual(["good"]);
    expect(diagnostics).toHaveLength(urls.length);
  });

  it("keeps valid literal headers without expansion", () => {
    const { plugin, diagnostics } = loadServers({
      remote: {
        type: "streamable-http",
        url: "https://example.com/mcp",
        headers: {
          Authorization: "Bearer literal",
          "X-Plugin": "${PLUGIN_ROOT}",
          "X-Tab": "one\ttwo",
        },
      },
    });

    expect(diagnostics).toEqual([]);
    expect(plugin?.mcpServers[0].headers).toEqual({
      Authorization: "Bearer literal",
      "X-Plugin": "${PLUGIN_ROOT}",
      "X-Tab": "one\ttwo",
    });
  });

  it("rejects invalid names, values, types, and case-insensitive duplicate headers per server", () => {
    const { plugin, diagnostics } = loadServers({
      good: { type: "streamable-http", url: "https://example.com/mcp" },
      badName: {
        type: "streamable-http",
        url: "https://example.com/mcp",
        headers: { "Bad Header": "value" },
      },
      badValue: {
        type: "streamable-http",
        url: "https://example.com/mcp",
        headers: { "X-Test": "line\nfeed" },
      },
      badType: {
        type: "streamable-http",
        url: "https://example.com/mcp",
        headers: { "X-Test": 1 },
      },
      duplicate: {
        type: "streamable-http",
        url: "https://example.com/mcp",
        headers: { "X-Test": "one", "x-test": "two" },
      },
      notObject: {
        type: "streamable-http",
        url: "https://example.com/mcp",
        headers: [],
      },
    });

    expect(plugin?.mcpServers.map((server) => server.name)).toEqual(["good"]);
    expect(diagnostics).toHaveLength(5);
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes("case-insensitively"))).toBe(
      true
    );
  });
});
