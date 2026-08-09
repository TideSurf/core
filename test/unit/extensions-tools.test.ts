import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  dispatchTool,
  executeValidatedToolSpec,
  getToolSpec,
} from "../../src/tools/registry.js";
import type { ToolResult } from "../../src/types.js";

const ENV_KEYS = [
  "TIDESURF_SKILLS_DIR",
  "TIDESURF_PLUGINS_DIR",
  "TIDESURF_EXTENSIONS",
] as const;

let root: string;
let savedEnv: Record<string, string | undefined>;

function writeSkill(dir: string, name: string, description: string, body: string): void {
  const skillDir = join(dir, name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`
  );
}

async function run(name: string, input: Record<string, unknown>, readOnly = false): Promise<ToolResult> {
  return dispatchTool(
    { name, input },
    { readOnly },
    (tool, toolInput) => executeValidatedToolSpec(null, tool, toolInput)
  );
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "tidesurf-extensions-tools-"));
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  rmSync(root, { recursive: true, force: true });
});

describe("skill tools", () => {
  it("list_skills and read_skill are read-only and browser-free", () => {
    for (const name of ["list_skills", "read_skill"]) {
      const spec = getToolSpec(name);
      expect(spec).toBeDefined();
      expect(spec!.readOnlyAllowed).toBe(true);
      expect(spec!.requiresBrowser).toBe(false);
    }
  });

  it("list_skills returns an empty catalog when nothing is installed", async () => {
    process.env["TIDESURF_SKILLS_DIR"] = join(root, "empty-skills");
    process.env["TIDESURF_PLUGINS_DIR"] = join(root, "empty-plugins");
    const result = await run("list_skills", {});
    expect(result.success).toBe(true);
    const data = result.data as { skills: unknown[] };
    expect(data.skills).toEqual([]);
  });

  it("list_skills catalogs skills from the skills root", async () => {
    const skillsDir = join(root, "skills");
    writeSkill(skillsDir, "alpha-skill", "Alpha does A", "Alpha body");
    writeSkill(skillsDir, "beta-skill", "Beta does B", "Beta body");
    process.env["TIDESURF_SKILLS_DIR"] = skillsDir;
    process.env["TIDESURF_PLUGINS_DIR"] = join(root, "empty-plugins");

    const result = await run("list_skills", {});
    expect(result.success).toBe(true);
    const data = result.data as { skills: Array<{ name: string; description: string }> };
    expect(data.skills.map((entry) => entry.name).sort()).toEqual([
      "alpha-skill",
      "beta-skill",
    ]);
  });

  it("read_skill returns the full document and stays valid in read-only mode", async () => {
    const skillsDir = join(root, "skills");
    writeSkill(skillsDir, "alpha-skill", "Alpha does A", "Alpha body text");
    process.env["TIDESURF_SKILLS_DIR"] = skillsDir;
    process.env["TIDESURF_PLUGINS_DIR"] = join(root, "empty-plugins");

    const result = await run("read_skill", { name: "alpha-skill" }, true);
    expect(result.success).toBe(true);
    const data = result.data as { name: string; content: string; files: string[] };
    expect(data.name).toBe("alpha-skill");
    expect(data.content).toContain("Alpha body text");
    expect(Array.isArray(data.files)).toBe(true);
  });

  it("read_skill rejects unknown names with the available list", async () => {
    const skillsDir = join(root, "skills");
    writeSkill(skillsDir, "alpha-skill", "Alpha does A", "Alpha body");
    process.env["TIDESURF_SKILLS_DIR"] = skillsDir;
    process.env["TIDESURF_PLUGINS_DIR"] = join(root, "empty-plugins");

    const result = await run("read_skill", { name: "missing" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown skill: missing");
    expect(result.error).toContain("alpha-skill");
  });

  it("read_skill requires a name", async () => {
    const result = await run("read_skill", {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("required");
  });
});
