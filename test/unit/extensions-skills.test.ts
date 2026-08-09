import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_SKILL_BODY_BYTES,
  MAX_SKILL_DIRECTORIES,
  MAX_SKILL_DIRECTORY_DEPTH,
  MAX_SKILL_DOCUMENT_BYTES,
  MAX_SKILL_FILES,
  loadSkillDirectory,
  loadSkillDocument,
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

function writeRawSkill(dir: string, raw: string | Uint8Array): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), raw);
}

function writeSkill(dir: string, lines: string[], body = "# Body\n"): string {
  const raw = ["---", ...lines, "---", ""].join("\n") + body;
  writeRawSkill(dir, raw);
  return raw;
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
  it("loads only valid metadata and retains lazy compatibility fields", () => {
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

    const { skill, diagnostics } = loadSkillDirectory(dir, "project");

    expect(diagnostics).toEqual([]);
    expect(skill?.name).toBe("my-skill");
    expect(skill?.description).toBe("Does useful things");
    expect(skill?.directory).toBe(dir);
    expect(skill?.source).toBe("project");
    expect(skill?.plugin).toBeUndefined();
    expect(skill?.license).toBe("Apache-2.0");
    expect(skill?.compatibility).toBe("node >= 18");
    expect(skill?.allowedTools).toBe("Bash Read");
    expect(skill?.metadata).toEqual({ author: "team", version: "1.0" });
    expect(Object.getPrototypeOf(skill?.metadata)).toBeNull();
    expect(Object.keys(skill ?? {})).not.toContain("body");
    expect(Object.keys(skill ?? {})).not.toContain("files");
    expect(skill?.body).toBe("# Body\n");
    expect(skill?.files).toEqual(["notes.md", "scripts/run.sh"]);
  });

  it("accepts common flow metadata and explicit description indentation", () => {
    const dir = join(makeTemp(), "yaml-conformant");
    writeSkill(dir, [
      "name: yaml-conformant",
      "description: >2-",
      "  Uses common",
      "  Agent Skills YAML",
      'metadata: { author: example-org, version: "1.0" }',
    ]);

    const { skill, diagnostics } = loadSkillDirectory(dir, "project");
    expect(diagnostics).toEqual([]);
    expect(skill?.description).toBe("Uses common Agent Skills YAML");
    expect(skill?.metadata).toEqual({ author: "example-org", version: "1.0" });
  });

  it("sets the plugin field", () => {
    const dir = join(makeTemp(), "plug-skill");
    writeSkill(dir, ["name: plug-skill", "description: From a plugin"]);
    const { skill } = loadSkillDirectory(dir, "user", "my-plugin");
    expect(skill?.plugin).toBe("my-plugin");
  });

  it("requires a valid name exactly matching the parent directory", () => {
    const mismatch = join(makeTemp(), "real-name");
    writeSkill(mismatch, ["name: other-name", "description: Mismatch"]);
    const mismatched = loadSkillDirectory(mismatch, "project");
    expect(mismatched.skill).toBeUndefined();
    expect(mismatched.diagnostics[0].message).toContain("does not match");
    expect(mismatched.diagnostics[0].message).toContain("skipping");

    const invalid = join(makeTemp(), "valid-name");
    writeSkill(invalid, ["name: Invalid_Name!", "description: No repair"]);
    const invalidResult = loadSkillDirectory(invalid, "user");
    expect(invalidResult.skill).toBeUndefined();
    expect(invalidResult.diagnostics[0].message).not.toContain("using directory name");

    const missing = join(makeTemp(), "missing-name");
    writeSkill(missing, ["description: Missing"]);
    expect(loadSkillDirectory(missing, "project").skill).toBeUndefined();
  });

  it("requires a nonempty description of at most 1024 characters", () => {
    const missing = join(makeTemp(), "no-desc");
    writeSkill(missing, ["name: no-desc"]);
    expect(loadSkillDirectory(missing, "project").skill).toBeUndefined();

    const empty = join(makeTemp(), "empty-desc");
    writeSkill(empty, ["name: empty-desc", 'description: ""']);
    expect(loadSkillDirectory(empty, "project").skill).toBeUndefined();

    const native = join(makeTemp(), "native-desc");
    writeSkill(native, ["name: native-desc", "description: true"]);
    expect(loadSkillDirectory(native, "project").skill).toBeUndefined();

    const long = join(makeTemp(), "long-desc");
    writeSkill(long, ["name: long-desc", `description: ${"x".repeat(1025)}`]);
    const result = loadSkillDirectory(long, "project");
    expect(result.skill).toBeUndefined();
    expect(result.diagnostics[0].message).toContain("1024");
  });

  it("accepts block descriptions and counts Unicode code points", () => {
    const dir = join(makeTemp(), "block-desc");
    writeSkill(dir, [
      "name: block-desc",
      "description: >-",
      "  Does useful",
      "  things",
      `compatibility: ${"😀".repeat(500)}`,
    ]);
    const result = loadSkillDirectory(dir, "project");
    expect(result.diagnostics).toEqual([]);
    expect(result.skill?.description).toBe("Does useful things");
    expect(Array.from(result.skill?.compatibility ?? "")).toHaveLength(500);
  });

  it("rejects invalid optional fields instead of dropping or coercing them", () => {
    const cases: readonly { name: string; lines: readonly string[]; message: string }[] = [
      { name: "license-type", lines: ["license: true"], message: "license" },
      { name: "compat-empty", lines: ['compatibility: ""'], message: "compatibility" },
      { name: "compat-type", lines: ["compatibility: 18"], message: "compatibility" },
      {
        name: "compat-long",
        lines: [`compatibility: ${"x".repeat(501)}`],
        message: "500",
      },
      { name: "metadata-scalar", lines: ["metadata: value"], message: "metadata" },
      {
        name: "metadata-value",
        lines: ["metadata:", "  version: 1"],
        message: "metadata.version",
      },
      { name: "tools-type", lines: ["allowed-tools: true"], message: "allowed-tools" },
      { name: "unknown-field", lines: ["extra: value"], message: "unknown" },
    ];

    for (const testCase of cases) {
      const dir = join(makeTemp(), testCase.name);
      writeSkill(dir, [
        `name: ${testCase.name}`,
        "description: Invalid optional field",
        ...testCase.lines,
      ]);
      const result = loadSkillDirectory(dir, "project");
      expect(result.skill, testCase.name).toBeUndefined();
      expect(result.diagnostics[0].message, testCase.name).toContain(testCase.message);
    }
  });

  it("rejects sequence allowed-tools rather than repairing it", () => {
    const dir = join(makeTemp(), "sequence-tools");
    writeSkill(dir, [
      "name: sequence-tools",
      "description: Invalid sequence",
      "allowed-tools:",
      "  - Bash",
      "  - Read",
    ]);
    const result = loadSkillDirectory(dir, "project");
    expect(result.skill).toBeUndefined();
    expect(result.diagnostics[0].message).toContain("not parseable");
  });

  it("skips missing and malformed SKILL.md files", () => {
    const absent = join(makeTemp(), "no-file");
    mkdirSync(absent, { recursive: true });
    expect(loadSkillDirectory(absent, "project").skill).toBeUndefined();

    const plain = join(makeTemp(), "plain-md");
    writeRawSkill(plain, "# just markdown\n");
    const plainResult = loadSkillDirectory(plain, "project");
    expect(plainResult.skill).toBeUndefined();
    expect(plainResult.diagnostics[0].message).toContain("no frontmatter");

    const malformed = join(makeTemp(), "bad-fm");
    writeRawSkill(malformed, "---\nname: bad-fm\n");
    const malformedResult = loadSkillDirectory(malformed, "project");
    expect(malformedResult.skill).toBeUndefined();
    expect(malformedResult.diagnostics[0].message).toContain("not parseable");
  });

  it("rejects an oversized SKILL.md before UTF-8 decoding", () => {
    const dir = join(makeTemp(), "oversized");
    const prefix = Buffer.from(
      "---\nname: oversized\ndescription: Too large\n---\n",
      "utf8"
    );
    const bytes = Buffer.alloc(MAX_SKILL_DOCUMENT_BYTES + 1, 0xff);
    prefix.copy(bytes, 0);
    writeRawSkill(dir, bytes);

    const result = loadSkillDirectory(dir, "project");
    expect(result.skill).toBeUndefined();
    expect(result.diagnostics[0].message).toContain(`${MAX_SKILL_DOCUMENT_BYTES}`);
    expect(result.diagnostics[0].message).not.toContain("UTF-8");
    expect(MAX_SKILL_BODY_BYTES).toBe(MAX_SKILL_DOCUMENT_BYTES);
  });

  it("accepts an exact-limit document without truncating it", () => {
    const dir = join(makeTemp(), "exact-limit");
    const prefix = "---\nname: exact-limit\ndescription: At limit\n---\n";
    const body = "x".repeat(MAX_SKILL_DOCUMENT_BYTES - Buffer.byteLength(prefix));
    writeRawSkill(dir, prefix + body);

    const { skill, diagnostics } = loadSkillDirectory(dir, "project");
    expect(diagnostics).toEqual([]);
    expect(skill?.body).toBe(body);
    const document = loadSkillDocument(skill!);
    expect(Buffer.byteLength(document.raw)).toBe(MAX_SKILL_DOCUMENT_BYTES);
    expect(document.body).toBe(body);
  });
});

describe("loadSkillDocument", () => {
  it("revalidates every discovered metadata field before returning the activation document", () => {
    const dir = join(makeTemp(), "stable-metadata");
    const original = [
      "name: stable-metadata",
      "description: Original description",
      "license: Apache-2.0",
      "compatibility: node >= 18",
      "allowed-tools: Bash Read",
      "metadata:",
      "  author: team",
      '  version: "1.0"',
    ];
    writeSkill(dir, original, "original body\n");
    const { skill } = loadSkillDirectory(dir, "project");
    expect(skill).toBeDefined();

    const changedDocuments = [
      original.map((line) => line === "description: Original description" ? "description: Changed" : line),
      original.map((line) => line === "license: Apache-2.0" ? "license: MIT" : line),
      original.map((line) => line === "compatibility: node >= 18" ? "compatibility: bun" : line),
      original.map((line) => line === "allowed-tools: Bash Read" ? "allowed-tools: Read" : line),
      original.map((line) => line === "  author: team" ? "  author: another-team" : line),
      original.filter((line) => line !== '  version: "1.0"'),
    ];
    for (const lines of changedDocuments) {
      writeSkill(dir, lines, "replacement body\n");
      expect(() => loadSkillDocument(skill!)).toThrow(/metadata no longer matches/);
    }

    const currentRaw = writeSkill(dir, original, "replacement body\n");
    const document = loadSkillDocument(skill!);
    expect(document.raw).toBe(currentRaw);
    expect(document.body).toBe("replacement body\n");
  });

  it("returns the exact raw document, body, and sorted resource files", () => {
    const root = makeTemp();
    const dir = join(root, "documented");
    const raw = "---\r\nname: documented\r\ndescription: Exact\r\n---\r\n# Body\r\n";
    writeRawSkill(dir, raw);
    mkdirSync(join(dir, "scripts"));
    writeFileSync(join(dir, "z.txt"), "z\n");
    writeFileSync(join(dir, "scripts", "run.sh"), "run\n");
    writeFileSync(join(dir, ".hidden"), "hidden\n");
    writeFileSync(join(root, "outside.txt"), "secret\n");
    mkdirSync(join(root, "outside-dir"));
    symlinkSync(join(root, "outside.txt"), join(dir, "linked.txt"));
    symlinkSync(join(root, "outside-dir"), join(dir, "linked-dir"));

    const { skill } = loadSkillDirectory(dir, "project");
    const document = loadSkillDocument(skill!);

    expect(document.raw).toBe(raw);
    expect(document.body).toBe("# Body\r\n");
    expect(document.files).toEqual(["scripts/run.sh", "z.txt"]);
  });

  it("does not walk resources while loading metadata", () => {
    const dir = join(makeTemp(), "progressive");
    writeSkill(dir, ["name: progressive", "description: Metadata first"]);
    let current = dir;
    for (let depth = 0; depth <= MAX_SKILL_DIRECTORY_DEPTH; depth += 1) {
      current = join(current, `d${depth}`);
      mkdirSync(current);
    }
    writeFileSync(join(current, "deep.txt"), "deep\n");

    const result = loadSkillDirectory(dir, "project");
    expect(result.skill).toBeDefined();
    expect(result.diagnostics).toEqual([]);
    expect(result.skill?.body).toBe("# Body\n");
    expect(() => loadSkillDocument(result.skill!)).toThrow(/depth limit/);
  });

  it("enforces the file cap without truncating the resource list", () => {
    const dir = join(makeTemp(), "many-files");
    writeSkill(dir, ["name: many-files", "description: Bounded files"]);
    for (let index = 0; index <= MAX_SKILL_FILES; index += 1) {
      writeFileSync(join(dir, `file-${index.toString().padStart(4, "0")}.txt`), "x");
    }

    const { skill } = loadSkillDirectory(dir, "project");
    expect(skill).toBeDefined();
    expect(() => loadSkillDocument(skill!)).toThrow(/file limit/);
  });

  it("enforces the directory cap", () => {
    const dir = join(makeTemp(), "many-dirs");
    writeSkill(dir, ["name: many-dirs", "description: Bounded directories"]);
    for (let index = 0; index < MAX_SKILL_DIRECTORIES; index += 1) {
      mkdirSync(join(dir, `dir-${index.toString().padStart(3, "0")}`));
    }

    const { skill } = loadSkillDirectory(dir, "project");
    expect(skill).toBeDefined();
    expect(() => loadSkillDocument(skill!)).toThrow(/directory limit/);
  });

  it("allows resources at depth 16 and rejects depth 17", () => {
    const dir = join(makeTemp(), "depth-limit");
    writeSkill(dir, ["name: depth-limit", "description: Bounded depth"]);
    let current = dir;
    for (let depth = 1; depth <= MAX_SKILL_DIRECTORY_DEPTH; depth += 1) {
      current = join(current, `d${depth}`);
      mkdirSync(current);
    }
    writeFileSync(join(current, "allowed.txt"), "ok\n");

    const { skill } = loadSkillDirectory(dir, "project");
    expect(loadSkillDocument(skill!).files).toEqual([
      `${Array.from({ length: MAX_SKILL_DIRECTORY_DEPTH }, (_, index) => `d${index + 1}`).join("/")}/allowed.txt`,
    ]);

    const tooDeep = join(current, "d17");
    mkdirSync(tooDeep);
    writeFileSync(join(tooDeep, "rejected.txt"), "no\n");
    expect(() => loadSkillDocument(skill!)).toThrow(/depth limit/);
  });
});
