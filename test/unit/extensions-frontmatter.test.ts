import { describe, expect, it } from "bun:test";
import { parseFrontmatter } from "../../src/extensions/frontmatter.js";

describe("parseFrontmatter", () => {
  it("parses plain and quoted scalars, keeping booleans and numbers as strings", () => {
    const parsed = parseFrontmatter(
      [
        "---",
        "name: my-skill",
        "single: 'single quoted'",
        'double: "double quoted"',
        "flag: true",
        "count: 42",
        "nil: null",
        "---",
        "# Body",
        "",
      ].join("\n")
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.data).toEqual({
      name: "my-skill",
      single: "single quoted",
      double: "double quoted",
      flag: "true",
      count: "42",
      nil: "null",
    });
    expect(parsed?.body).toBe("# Body\n");
  });

  it("parses a nested map with exactly 2-space indentation", () => {
    const parsed = parseFrontmatter(
      "---\nname: x\ndescription: d\nmetadata:\n  author: team\n  version: \"1.0\"\n---\nbody"
    );
    expect(parsed?.data.metadata).toEqual({ author: "team", version: "1.0" });
    expect(parsed?.body).toBe("body");
  });

  it("ignores comment lines and blank lines, and strips inline comments on plain scalars", () => {
    const parsed = parseFrontmatter(
      [
        "---",
        "# leading comment",
        "",
        "name: foo # trailing comment",
        "sticky: bar#not-a-comment",
        'quoted: "keep # this"',
        "  # comment inside a map",
        "metadata:",
        "  a: 1 # strip me",
        "---",
        "",
      ].join("\n")
    );
    expect(parsed?.data).toEqual({
      name: "foo",
      sticky: "bar#not-a-comment",
      quoted: "keep # this",
      metadata: { a: "1" },
    });
  });

  it("handles CRLF line endings", () => {
    const parsed = parseFrontmatter("---\r\nname: x\r\nmetadata:\r\n  a: b\r\n---\r\nbody line\r\n");
    expect(parsed?.data).toEqual({ name: "x", metadata: { a: "b" } });
    expect(parsed?.body).toBe("body line\r\n");
  });

  it("returns null when the document does not start with a frontmatter block", () => {
    expect(parseFrontmatter("# Just markdown\n---\nname: x\n---\n")).toBeNull();
    expect(parseFrontmatter("name: x\n")).toBeNull();
    expect(parseFrontmatter("")).toBeNull();
    expect(parseFrontmatter("--- not-frontmatter\nname: x\n---\n")).toBeNull();
  });

  it("throws a plain Error when the block is unclosed", () => {
    expect(() => parseFrontmatter("---\nname: x\n")).toThrow(Error);
    expect(() => parseFrontmatter("---\nname: x\n")).toThrow(/not closed/);
    expect(() => parseFrontmatter("---")).toThrow(/not closed/);
  });

  it("throws on tab indentation", () => {
    expect(() => parseFrontmatter("---\n\tname: x\n---\n")).toThrow(/tab/);
    expect(() => parseFrontmatter("---\nmetadata:\n \ta: b\n---\n")).toThrow(/tab/);
  });

  it("throws on indented content under a scalar key", () => {
    expect(() => parseFrontmatter("---\nname: x\n  bad: y\n---\n")).toThrow(/indent/);
  });

  it("throws on YAML outside the supported subset", () => {
    expect(() => parseFrontmatter("---\n- item\n---\n")).toThrow(/unsupported YAML/);
    expect(() => parseFrontmatter("---\nmetadata:\n    deep: x\n---\n")).toThrow(/2-space/);
    expect(() => parseFrontmatter("---\nkey:no-space\n---\n")).toThrow(/unsupported YAML/);
    expect(() => parseFrontmatter("---\n: empty-key\n---\n")).toThrow(/empty key/);
  });

  it("decodes double-quoted escapes and single-quoted doubled quotes", () => {
    const parsed = parseFrontmatter(
      '---\na: "line\\nbreak\\t\\"q\\""\nb: \'it\'\'s\'\n---\n'
    );
    expect(parsed?.data.a).toBe('line\nbreak\t"q"');
    expect(parsed?.data.b).toBe("it's");
  });

  it("rejects unterminated and malformed quoted scalars", () => {
    expect(() => parseFrontmatter('---\na: "unterminated\n---\n')).toThrow(/unterminated/);
    expect(() => parseFrontmatter("---\na: 'unterminated\n---\n")).toThrow(/unterminated/);
    expect(() => parseFrontmatter('---\na: "bad" trailing\n---\n')).toThrow(
      /after quoted scalar/
    );
  });

  it("treats an empty value with no nested entries as an empty string", () => {
    const parsed = parseFrontmatter("---\nname: x\ndescription:\n---\n");
    expect(parsed?.data.description).toBe("");
  });

  it("parses block sequences into string arrays", () => {
    const parsed = parseFrontmatter(
      "---\nname: x\nallowed-tools:\n  - Bash(git:*)\n  - Read\n---\n"
    );
    expect(parsed?.data["allowed-tools"]).toEqual(["Bash(git:*)", "Read"]);
  });

  it("rejects mixing sequence items and map entries in one block", () => {
    expect(() =>
      parseFrontmatter("---\nmetadata:\n  a: b\n  - item\n---\n")
    ).toThrow(/mix/);
    expect(() =>
      parseFrontmatter("---\nmetadata:\n  - item\n  a: b\n---\n")
    ).toThrow(/mix/);
  });
});
