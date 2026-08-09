import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadPlugin,
  pluginDataDirectory,
  validatePluginName,
} from "../../src/extensions/plugins.js";

const CANONICAL_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";

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
  return { $schema: CANONICAL_SCHEMA, name: "my-plugin", ...extra };
}

function writePlugin(dir: string, doc: unknown, mcp?: unknown): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "plugin.json"), typeof doc === "string" ? doc : JSON.stringify(doc));
  if (mcp !== undefined) {
    writeFileSync(join(dir, "mcp.json"), typeof mcp === "string" ? mcp : JSON.stringify(mcp));
  }
}

function writeSkill(dir: string, lines: string[]): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), ["---", ...lines, "---", "# body\n"].join("\n"));
}

describe("validatePluginName", () => {
  it("accepts valid names", () => {
    for (const name of ["a", "my-plugin", "a.b", "a1", "x".repeat(64)]) {
      expect(validatePluginName(name)).toBeUndefined();
    }
  });

  it("rejects invalid names", () => {
    expect(validatePluginName(1)).toBeTypeOf("string");
    expect(validatePluginName(null)).toBeTypeOf("string");
    expect(validatePluginName("")).toBeTypeOf("string");
    for (const name of ["A", "a..b", "a--b", "-a", "a-", ".a", "a.", "a_b", "x".repeat(65)]) {
      expect(validatePluginName(name)).toBeTypeOf("string");
    }
  });
});

describe("pluginDataDirectory", () => {
  it("builds the per-plugin data path under home", () => {
    expect(pluginDataDirectory("/home/u", "my-plugin")).toBe(
      join("/home/u", ".tidesurf", "plugin-data", "my-plugin")
    );
  });
});

describe("loadPlugin manifest validation", () => {
  it("loads a valid minimal plugin", () => {
    const home = makeTemp();
    const dir = join(makeTemp(), "my-plugin");
    writePlugin(dir, manifest());
    const { plugin, diagnostics } = loadPlugin(dir, "project", home);
    expect(diagnostics).toEqual([]);
    expect(plugin?.name).toBe("my-plugin");
    expect(plugin?.source).toBe("project");
    expect(plugin?.directory).toBe(dir);
    expect(plugin?.manifest).toEqual({ name: "my-plugin" });
    expect(plugin?.skills).toEqual([]);
    expect(plugin?.mcpServers).toEqual([]);
    expect(plugin?.mcpDisabled).toBeUndefined();
  });

  it("keeps the optional manifest fields", () => {
    const dir = join(makeTemp(), "my-plugin");
    writePlugin(
      dir,
      manifest({
        version: "1.2.3",
        description: "A plugin",
        author: { name: "Team", email: "team@example.com", url: "https://example.com" },
        homepage: "https://example.com",
        repository: "https://example.com/repo",
        license: "Apache-2.0",
        keywords: ["a", "b"],
        extensions: { "x-custom": { nested: true } },
      })
    );
    const { plugin } = loadPlugin(dir, "user", makeTemp());
    expect(plugin?.manifest.version).toBe("1.2.3");
    expect(plugin?.manifest.author).toEqual({
      name: "Team",
      email: "team@example.com",
      url: "https://example.com",
    });
    expect(plugin?.manifest.keywords).toEqual(["a", "b"]);
    expect(plugin?.manifest.extensions).toEqual({ "x-custom": { nested: true } });
  });

  it("rejects invalid plugin names as fatal", () => {
    for (const name of ["A", "a..b", "a--b", "-a", "a-", "x".repeat(65)]) {
      const dir = join(makeTemp(), "fixture");
      writePlugin(dir, manifest({ name }));
      const { plugin, diagnostics } = loadPlugin(dir, "project", makeTemp());
      expect(plugin).toBeUndefined();
      expect(diagnostics.some((d) => d.message.includes("invalid plugin name"))).toBe(true);
    }
  });

  it("rejects a missing name as fatal", () => {
    const dir = join(makeTemp(), "fixture");
    writePlugin(dir, { $schema: CANONICAL_SCHEMA });
    const { plugin, diagnostics } = loadPlugin(dir, "project", makeTemp());
    expect(plugin).toBeUndefined();
    expect(diagnostics.some((d) => d.message.includes("invalid plugin name"))).toBe(true);
  });

  it("warns on unknown top-level fields but still loads", () => {
    const dir = join(makeTemp(), "my-plugin");
    writePlugin(dir, manifest({ "x-extra": true }));
    const { plugin, diagnostics } = loadPlugin(dir, "project", makeTemp());
    expect(plugin).toBeDefined();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('unknown top-level field "x-extra"');
    expect(diagnostics[0].plugin).toBe("my-plugin");
  });

  it("rejects wrong-typed known fields as fatal", () => {
    const cases: Record<string, unknown>[] = [
      { version: 1 },
      { description: {} },
      { homepage: true },
      { author: "Team" },
      { author: { name: 1 } },
      { keywords: "not-an-array" },
      { keywords: ["a", 1] },
      { extensions: [1] },
    ];
    for (const extra of cases) {
      const dir = join(makeTemp(), "fixture");
      writePlugin(dir, manifest(extra));
      const { plugin, diagnostics } = loadPlugin(dir, "project", makeTemp());
      expect(plugin).toBeUndefined();
      expect(diagnostics.some((d) => d.message.includes("must be"))).toBe(true);
    }
  });

  it("rejects a missing or non-string $schema as fatal", () => {
    const missing = join(makeTemp(), "fixture");
    writePlugin(missing, { name: "my-plugin" });
    expect(loadPlugin(missing, "project", makeTemp()).plugin).toBeUndefined();

    const wrongType = join(makeTemp(), "fixture");
    writePlugin(wrongType, { name: "my-plugin", $schema: 1 });
    const result = loadPlugin(wrongType, "project", makeTemp());
    expect(result.plugin).toBeUndefined();
    expect(result.diagnostics.some((d) => d.message.includes("$schema"))).toBe(true);
  });

  it("warns on a non-canonical $schema string but continues", () => {
    const dir = join(makeTemp(), "my-plugin");
    writePlugin(dir, manifest({ $schema: "https://example.com/schemas/9.9.9/plugin.schema.json" }));
    const { plugin, diagnostics } = loadPlugin(dir, "project", makeTemp());
    expect(plugin).toBeDefined();
    expect(diagnostics.some((d) => d.message.includes("unrecognized $schema"))).toBe(true);
  });

  it("skips plugins with missing, unparseable, or non-object plugin.json", () => {
    const missing = join(makeTemp(), "fixture");
    mkdirSync(missing, { recursive: true });
    expect(loadPlugin(missing, "project", makeTemp()).plugin).toBeUndefined();

    const invalid = join(makeTemp(), "fixture");
    writePlugin(invalid, "{not json");
    expect(loadPlugin(invalid, "project", makeTemp()).plugin).toBeUndefined();

    const array = join(makeTemp(), "fixture");
    writePlugin(array, [1, 2]);
    expect(loadPlugin(array, "project", makeTemp()).plugin).toBeUndefined();
  });
});

describe("loadPlugin skills discovery", () => {
  it("loads immediate skills subdirectories with the plugin name set", () => {
    const dir = join(makeTemp(), "my-plugin");
    writePlugin(dir, manifest());
    writeSkill(join(dir, "skills", "alpha"), ["name: alpha", "description: Alpha skill"]);
    mkdirSync(join(dir, "skills", "no-skill-md"), { recursive: true });
    writeFileSync(join(dir, "skills", "loose.txt"), "x");
    const { plugin, diagnostics } = loadPlugin(dir, "user", makeTemp());
    expect(diagnostics).toEqual([]);
    expect(plugin?.skills).toHaveLength(1);
    expect(plugin?.skills[0].name).toBe("alpha");
    expect(plugin?.skills[0].plugin).toBe("my-plugin");
    expect(plugin?.skills[0].source).toBe("user");
  });

  it("keeps the plugin when a skill is bad and prefixes skill diagnostics with plugin context", () => {
    const dir = join(makeTemp(), "my-plugin");
    writePlugin(dir, manifest());
    writeSkill(join(dir, "skills", "bad"), ["name: bad"]);
    const { plugin, diagnostics } = loadPlugin(dir, "user", makeTemp());
    expect(plugin).toBeDefined();
    expect(plugin?.skills).toEqual([]);
    expect(
      diagnostics.some(
        (d) => d.plugin === "my-plugin" && d.message.includes('skill "bad":') && d.message.includes("description")
      )
    ).toBe(true);
  });
});

describe("loadPlugin mcp.json", () => {
  function stdioPlugin(entry: Record<string, unknown>, home: string) {
    const dir = join(makeTemp(), "my-plugin");
    writePlugin(dir, manifest(), { mcpServers: { server1: entry } });
    return loadPlugin(dir, "user", home);
  }

  it("loads a stdio server with single-pass placeholder expansion", () => {
    const home = makeTemp();
    const { plugin, diagnostics } = stdioPlugin(
      {
        type: "stdio",
        command: "node",
        args: ["${PLUGIN_ROOT}/server.js", "--flag"],
        env: { DATA_DIR: "${PLUGIN_DATA}", PLAIN: "x" },
        cwd: ".",
      },
      home
    );
    const dir = plugin?.directory ?? "";
    expect(diagnostics).toEqual([]);
    expect(plugin?.mcpServers).toHaveLength(1);
    const server = plugin?.mcpServers[0];
    expect(server?.name).toBe("server1");
    expect(server?.type).toBe("stdio");
    expect(server?.command).toBe("node");
    expect(server?.args).toEqual([`${dir}/server.js`, "--flag"]);
    expect(server?.env?.DATA_DIR).toBe(pluginDataDirectory(home, "my-plugin"));
    expect(server?.env?.PLAIN).toBe("x");
    expect(server?.cwd).toBe(dir);
  });

  it("does not re-expand placeholder text produced by expansion", () => {
    const home = join(makeTemp(), "home-${PLUGIN_ROOT}");
    mkdirSync(home, { recursive: true });
    const { plugin, diagnostics } = stdioPlugin(
      { type: "stdio", command: "node", env: { DATA: "${PLUGIN_DATA}" } },
      home
    );
    expect(diagnostics).toEqual([]);
    const expected = pluginDataDirectory(home, "my-plugin");
    expect(expected).toContain("${PLUGIN_ROOT}");
    expect(plugin?.mcpServers[0].env?.DATA).toBe(expected);
    expect(plugin?.mcpServers[0].env?.DATA).toContain("${PLUGIN_ROOT}");
  });

  it("accepts ./ relative commands and defaults cwd to the plugin root", () => {
    const home = makeTemp();
    const { plugin } = stdioPlugin({ type: "stdio", command: "./bin/run.sh" }, home);
    const server = plugin?.mcpServers[0];
    expect(server?.command).toBe("./bin/run.sh");
    expect(server?.cwd).toBe(plugin?.directory);
  });

  it("rejects absolute, ~, whitespace, and shell-metacharacter commands", () => {
    const home = makeTemp();
    for (const command of [
      "/usr/bin/node",
      "~/bin/run",
      "node server.js",
      "a;b",
      "a&&b",
      "a|b",
      "a>b",
      "a$b",
      "a`b`",
      "a(b)",
    ]) {
      const { plugin } = stdioPlugin({ type: "stdio", command }, home);
      expect(plugin?.mcpServers).toEqual([]);
      expect(
        plugin?.diagnostics.some((d) => d.message.includes('mcp server "server1"'))
      ).toBe(true);
    }
  });

  it("resolves relative cwd against the plugin root and rejects containment escapes", () => {
    const home = makeTemp();
    const ok = join(makeTemp(), "my-plugin");
    mkdirSync(join(ok, "sub"), { recursive: true });
    writePlugin(ok, manifest(), { mcpServers: { s: { type: "stdio", command: "node", cwd: "sub" } } });
    expect(loadPlugin(ok, "user", home).plugin?.mcpServers[0].cwd).toBe(join(ok, "sub"));

    for (const cwd of ["../..", ".."]) {
      const { plugin } = stdioPlugin({ type: "stdio", command: "node", cwd }, home);
      expect(plugin?.mcpServers).toEqual([]);
      expect(plugin?.diagnostics.some((d) => d.message.includes("outside the plugin root"))).toBe(
        true
      );
    }
  });

  it("skips servers with unknown placeholders", () => {
    const home = makeTemp();
    const { plugin } = stdioPlugin({ type: "stdio", command: "node", args: ["${UNKNOWN}"] }, home);
    expect(plugin?.mcpServers).toEqual([]);
    expect(plugin?.diagnostics.some((d) => d.message.includes("placeholders"))).toBe(true);

    const envCase = stdioPlugin(
      { type: "stdio", command: "node", env: { X: "${PLUGIN_ROOT}/${NOPE}" } },
      home
    );
    expect(envCase.plugin?.mcpServers).toEqual([]);
  });

  it("skips sse servers with a deprecated diagnostic and unknown types with a diagnostic", () => {
    const home = makeTemp();
    const { plugin } = stdioPlugin({ type: "sse", url: "https://example.com/sse" }, home);
    expect(plugin?.mcpServers).toEqual([]);
    expect(plugin?.diagnostics.some((d) => d.message.includes("deprecated"))).toBe(true);

    const unknown = stdioPlugin({ type: "websocket" }, home);
    expect(unknown.plugin?.mcpServers).toEqual([]);
    expect(unknown.plugin?.diagnostics.some((d) => d.message.includes("unknown type"))).toBe(true);

    const missing = stdioPlugin({ command: "node" }, home);
    expect(missing.plugin?.mcpServers).toEqual([]);
  });

  it("loads streamable-http servers and enforces the url rules", () => {
    const home = makeTemp();
    for (const url of ["http://127.0.0.1:8080/mcp", "http://localhost:9/mcp", "http://[::1]:9/mcp", "https://example.com/mcp"]) {
      const dir = join(makeTemp(), "my-plugin");
      writePlugin(dir, manifest(), {
        mcpServers: { s: { type: "streamable-http", url, headers: { A: "b" } } },
      });
      const { plugin } = loadPlugin(dir, "user", home);
      expect(plugin?.mcpServers).toHaveLength(1);
      expect(plugin?.mcpServers[0].type).toBe("streamable-http");
      expect(plugin?.mcpServers[0].url).toBe(url);
      expect(plugin?.mcpServers[0].headers).toEqual({ A: "b" });
    }

    for (const url of [
      "http://example.com/mcp",
      "https://user:pass@example.com/mcp",
      "https://example.com/mcp#frag",
      "not a url",
    ]) {
      const dir = join(makeTemp(), "my-plugin");
      writePlugin(dir, manifest(), { mcpServers: { s: { type: "streamable-http", url } } });
      const { plugin } = loadPlugin(dir, "user", home);
      expect(plugin?.mcpServers).toEqual([]);
      expect(plugin?.diagnostics.some((d) => d.message.includes('mcp server "s"'))).toBe(true);
    }
  });

  it("warns on unknown server fields but keeps the server", () => {
    const home = makeTemp();
    const { plugin } = stdioPlugin({ type: "stdio", command: "node", note: "x" }, home);
    expect(plugin?.mcpServers).toHaveLength(1);
    expect(plugin?.diagnostics.some((d) => d.message.includes('unknown field(s) "note"'))).toBe(
      true
    );
  });

  it("disables mcp when the plugin.json and mcp.json $schema versions differ", () => {
    const home = makeTemp();
    const dir = join(makeTemp(), "my-plugin");
    writePlugin(dir, manifest(), {
      $schema: "https://agent-plugins.org/schemas/2.0.0/mcp.schema.json",
      mcpServers: { s: { type: "stdio", command: "node" } },
    });
    const { plugin } = loadPlugin(dir, "user", home);
    expect(plugin).toBeDefined();
    expect(plugin?.mcpDisabled).toContain("does not match");
    expect(plugin?.mcpServers).toEqual([]);
    expect(plugin?.diagnostics.some((d) => d.message.includes("does not match"))).toBe(true);
  });

  it("disables mcp when mcp.json is broken and reports no diagnostic when absent", () => {
    const home = makeTemp();

    const absent = join(makeTemp(), "my-plugin");
    writePlugin(absent, manifest());
    const absentResult = loadPlugin(absent, "user", home);
    expect(absentResult.plugin?.mcpDisabled).toBeUndefined();
    expect(absentResult.diagnostics).toEqual([]);

    const invalid = join(makeTemp(), "my-plugin");
    writePlugin(invalid, manifest(), "{nope");
    expect(loadPlugin(invalid, "user", home).plugin?.mcpDisabled).toContain("not valid JSON");

    const notObject = join(makeTemp(), "my-plugin");
    writePlugin(notObject, manifest(), [1]);
    expect(loadPlugin(notObject, "user", home).plugin?.mcpDisabled).toContain("JSON object");

    const noServers = join(makeTemp(), "my-plugin");
    writePlugin(noServers, manifest(), {});
    expect(loadPlugin(noServers, "user", home).plugin?.mcpDisabled).toContain("mcpServers");
  });
});
