import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_SKILL_BODY_BYTES,
  loadSkillDirectory,
  validateSkillName,
} from "../../src/extensions/skills.js";

let tempDirs: string[] = [];

function makeTemp(): string {
  const dir = mkdtempSync(join(tmpdir(), "tidesurf-skills-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

function writeSkill(dir: string, lines: string[], body = "# Body\n"): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), ["---", ...lines, "---", ""].join("\n") + body);
}

describe("validateSkillName", () => {
  it("accepts valid names", () => {
    for (const name of ["a", "abc", "a-b", "a-b-c", "a1", "1a", "x".repeat(64)]) {
      expect(validateSkillName(name)).toBeUndefined();
    }
  });

  it("rejects invalid names", () => {
    for (const name of ["", "A", "-a", "a-", "a--b", "a_b", "a b", "x".repeat(65)]) {
      expect(validateSkillName(name)).toBeTypeOf("string");
    }
  });
});

describe("loadSkillDirectory", () => {
  it("loads a fully populated skill", () => {
    const root = makeTemp();
    const dir = join(root, "my-skill");
    writeSkill(dir, [
      "name: my-skill",
      "description: Does useful things",
      "license: Apache-2.0",
      "compatibility: node >= 18",
      "allowed-tools: Bash Read",
      "metadata:",
      "  author: team",
      '  version: "1.0"',
    ]);
    mkdirSync(join(dir, "scripts"), { recursive: true });
    writeFileSync(join(dir, "scripts", "run.sh"), "echo hi\n");
    writeFileSync(join(dir, "notes.md"), "notes\n");
    writeFileSync(join(dir, ".hidden"), "secret\n");
    mkdirSync(join(dir, ".git"));
    writeFileSync(join(dir, ".git", "config"), "secret\n");

    const { skill, diagnostics } = loadSkillDirectory(dir, "project");
    expect(diagnostics).toEqual([]);
    expect(skill?.name).toBe("my-skill");
    expect(skill?.description).toBe("Does useful things");
    expect(skill?.directory).toBe(dir);
    expect(skill?.source).toBe("project");
    expect(skill?.plugin).toBeUndefined();
    expect(skill?.body).toBe("# Body\n");
    expect(skill?.license).toBe("Apache-2.0");
    expect(skill?.compatibility).toBe("node >= 18");
    expect(skill?.allowedTools).toBe("Bash Read");
    expect(skill?.metadata).toEqual({ author: "team", version: "1.0" });
    expect(skill?.files).toEqual(["notes.md", "scripts/run.sh"]);
  });

  it("joins a YAML block-sequence allowed-tools into a space-separated string", () => {
    const root = makeTemp();
    const dir = join(root, "seq-skill");
    writeSkill(dir, [
      "name: seq-skill",
      "description: Uses a list of tools",
      "allowed-tools:",
      "  - Bash(npx impeccable *)",
      "  - Read",
    ]);
    const { skill, diagnostics } = loadSkillDirectory(dir, "project");
    expect(diagnostics).toEqual([]);
    expect(skill?.allowedTools).toBe("Bash(npx impeccable *) Read");
  });

  it("sets the plugin field when loaded from a plugin", () => {
    const dir = join(makeTemp(), "plug-skill");
    writeSkill(dir, ["name: plug-skill", "description: From a plugin"]);
    const { skill } = loadSkillDirectory(dir, "user", "my-plugin");
    expect(skill?.plugin).toBe("my-plugin");
  });

  it("warns when the frontmatter name does not match the directory basename", () => {
    const dir = join(makeTemp(), "real-name");
    writeSkill(dir, ["name: other-name", "description: Mismatch"]);
    const { skill, diagnostics } = loadSkillDirectory(dir, "project");
    expect(skill?.name).toBe("other-name");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('does not match directory name "real-name"');
    expect(diagnostics[0].skill).toBe("other-name");
  });

  it("falls back to the directory basename when the frontmatter name is invalid", () => {
    const dir = join(makeTemp(), "valid-name");
    writeSkill(dir, ["name: Invalid_Name!", "description: Fallback"]);
    const { skill, diagnostics } = loadSkillDirectory(dir, "user");
    expect(skill?.name).toBe("valid-name");
    expect(diagnostics.some((d) => d.message.includes('using directory name "valid-name"'))).toBe(
      true
    );
  });

  it("skips the skill when both frontmatter name and directory basename are invalid", () => {
    const dir = join(makeTemp(), "Invalid Dir");
    writeSkill(dir, ["name: Also Bad!", "description: Hopeless"]);
    const { skill, diagnostics } = loadSkillDirectory(dir, "user");
    expect(skill).toBeUndefined();
    expect(diagnostics.some((d) => d.message.includes("skipping"))).toBe(true);
  });

  it("skips the skill when the description is missing or empty", () => {
    const missing = join(makeTemp(), "no-desc");
    writeSkill(missing, ["name: no-desc"]);
    expect(loadSkillDirectory(missing, "project").skill).toBeUndefined();
    expect(
      loadSkillDirectory(missing, "project").diagnostics[0].message
    ).toContain("description");

    const empty = join(makeTemp(), "empty-desc");
    writeSkill(empty, ["name: empty-desc", 'description: ""']);
    const result = loadSkillDirectory(empty, "project");
    expect(result.skill).toBeUndefined();
    expect(result.diagnostics[0].message).toContain("description");
  });

  it("keeps an over-long description with a diagnostic", () => {
    const dir = join(makeTemp(), "long-desc");
    writeSkill(dir, ["name: long-desc", `description: ${"x".repeat(1100)}`]);
    const { skill, diagnostics } = loadSkillDirectory(dir, "project");
    expect(skill?.description).toHaveLength(1100);
    expect(diagnostics.some((d) => d.message.includes("1024"))).toBe(true);
  });

  it("skips the skill when there is no frontmatter block", () => {
    const dir = join(makeTemp(), "plain-md");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), "# just markdown\n");
    const { skill, diagnostics } = loadSkillDirectory(dir, "project");
    expect(skill).toBeUndefined();
    expect(diagnostics[0].message).toContain("no frontmatter block");
  });

  it("skips the skill when the frontmatter is unparseable", () => {
    const dir = join(makeTemp(), "bad-fm");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), "---\nname: bad-fm\n");
    const { skill, diagnostics } = loadSkillDirectory(dir, "project");
    expect(skill).toBeUndefined();
    expect(diagnostics[0].message).toContain("not parseable");
  });

  it("skips the skill when SKILL.md is unreadable or absent", () => {
    const dir = join(makeTemp(), "no-file");
    mkdirSync(dir, { recursive: true });
    const { skill, diagnostics } = loadSkillDirectory(dir, "project");
    expect(skill).toBeUndefined();
    expect(diagnostics[0].message).toContain("SKILL.md");
  });

  it("drops a scalar metadata value with a diagnostic", () => {
    const dir = join(makeTemp(), "meta-scalar");
    writeSkill(dir, ["name: meta-scalar", "description: Metadata", "metadata: not-a-map"]);
    const { skill, diagnostics } = loadSkillDirectory(dir, "project");
    expect(skill).toBeDefined();
    expect(skill?.metadata).toBeUndefined();
    expect(diagnostics.some((d) => d.message.includes("metadata must be a map of strings"))).toBe(
      true
    );
  });

  it("keeps an over-long compatibility value with a diagnostic", () => {
    const dir = join(makeTemp(), "compat-long");
    writeSkill(dir, [
      "name: compat-long",
      "description: Compatibility",
      `compatibility: ${"x".repeat(600)}`,
    ]);
    const { skill, diagnostics } = loadSkillDirectory(dir, "project");
    expect(skill?.compatibility).toHaveLength(600);
    expect(diagnostics.some((d) => d.message.includes("500"))).toBe(true);
  });

  it("never follows symlinks in the file listing", () => {
    const root = makeTemp();
    const dir = join(root, "linky");
    writeSkill(dir, ["name: linky", "description: Links"]);
    writeFileSync(join(root, "outside.txt"), "secret\n");
    mkdirSync(join(root, "outside-dir"));
    symlinkSync(join(root, "outside.txt"), join(dir, "linked.txt"));
    symlinkSync(join(root, "outside-dir"), join(dir, "linked-dir"));
    const { skill, diagnostics } = loadSkillDirectory(dir, "project");
    expect(diagnostics).toEqual([]);
    expect(skill?.files).toEqual([]);
  });

  it("truncates bodies larger than MAX_SKILL_BODY_BYTES", () => {
    const dir = join(makeTemp(), "big-body");
    writeSkill(dir, ["name: big-body", "description: Large"], "x".repeat(MAX_SKILL_BODY_BYTES + 10));
    const { skill, diagnostics } = loadSkillDirectory(dir, "project");
    const mark = "\n\n[skill body truncated]";
    expect(skill?.body.endsWith(mark)).toBe(true);
    expect(Buffer.byteLength(skill?.body ?? "", "utf8")).toBe(
      MAX_SKILL_BODY_BYTES + Buffer.byteLength(mark, "utf8")
    );
    expect(diagnostics.some((d) => d.message.includes("truncated"))).toBe(true);
  });
});
