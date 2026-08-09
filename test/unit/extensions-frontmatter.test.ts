import { describe, expect, it } from "bun:test";
import { parseFrontmatter } from "../../src/extensions/frontmatter.js";

describe("parseFrontmatter", () => {
  it("parses quoted strings and YAML 1.2 plain scalar types", () => {
    const parsed = parseFrontmatter(
      [
        "---",
        "name: my-skill",
        "single: 'single quoted'",
        'double: "double quoted"',
        'quoted-flag: "true"',
        "enabled: true",
        "disabled: FALSE",
        "nothing: null",
        "tilde: ~",
        "integer: -42",
        "float: 3.5",
        "exponent: 2e3",
        "hex: 0x10",
        "word: yes",
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
      "quoted-flag": "true",
      enabled: true,
      disabled: false,
      nothing: null,
      tilde: null,
      integer: -42,
      float: 3.5,
      exponent: 2000,
      hex: 16,
      word: "yes",
    });
    expect(parsed?.body).toBe("# Body\n");
  });

  it("parses one nested string map with any consistent valid indentation", () => {
    const parsed = parseFrontmatter(
      "---\nname: x\ndescription: d\nmetadata:\n    author: team\n    version: \"1.0\"\n---\nbody"
    );

    expect(Object.getPrototypeOf(parsed?.data)).toBeNull();
    expect(Object.getPrototypeOf(parsed?.data.metadata)).toBeNull();
    expect(parsed?.data.metadata).toEqual({ author: "team", version: "1.0" });
    expect(parsed?.body).toBe("body");
  });

  it("parses simple flow mappings without enabling nested flow structures", () => {
    const parsed = parseFrontmatter(
      [
        "---",
        'metadata: { author: example-org, version: "1.0", note: \'one, two: ok\' }',
        "empty: {}",
        'trailing: { owner: "team", } # allowed trailing comma',
        "---",
        "",
      ].join("\n")
    );

    expect(Object.getPrototypeOf(parsed?.data.metadata)).toBeNull();
    expect(parsed?.data.metadata).toEqual({
      author: "example-org",
      version: "1.0",
      note: "one, two: ok",
    });
    expect(parsed?.data.empty).toEqual({});
    expect(parsed?.data.trailing).toEqual({ owner: "team" });
  });

  it("keeps prototype-like keys as own properties", () => {
    const parsed = parseFrontmatter(
      "---\n__proto__: top\nconstructor: own\nmetadata:\n  __proto__: nested\n---\n"
    );
    const data = parsed?.data as Record<string, unknown>;
    const metadata = data.metadata as Record<string, unknown>;

    expect(Object.hasOwn(data, "__proto__")).toBe(true);
    expect(data.__proto__).toBe("top");
    expect(Object.hasOwn(data, "constructor")).toBe(true);
    expect(data.constructor).toBe("own");
    expect(Object.hasOwn(metadata, "__proto__")).toBe(true);
    expect(metadata.__proto__).toBe("nested");
  });

  it("parses literal and folded blocks with chomping indicators", () => {
    const parsed = parseFrontmatter(
      [
        "---",
        "empty: |",
        "blank: |",
        "",
        "literal: |",
        "  first",
        "  second",
        "strip: |-",
        "  first",
        "  second",
        "folded: >-",
        "  first",
        "  second",
        "",
        "  next paragraph",
        "keep: |+",
        "  final",
        "",
        "---",
        "",
      ].join("\n")
    );

    expect(parsed?.data.empty).toBe("");
    expect(parsed?.data.blank).toBe("");
    expect(parsed?.data.literal).toBe("first\nsecond\n");
    expect(parsed?.data.strip).toBe("first\nsecond");
    expect(parsed?.data.folded).toBe("first second\nnext paragraph");
    expect(parsed?.data.keep).toBe("final\n\n");
  });

  it("allows block strings as nested map values", () => {
    const parsed = parseFrontmatter(
      "---\nmetadata:\n  note: >-\n    line one\n    line two\n---\n"
    );
    expect(parsed?.data.metadata).toEqual({ note: "line one line two" });
  });

  it("honors explicit block indentation indicators in either YAML order", () => {
    const parsed = parseFrontmatter(
      [
        "---",
        "literal: |2",
        "  first",
        "    indented",
        "folded: >2-",
        "  line one",
        "  line two",
        "reverse: |-2",
        "  final",
        "metadata:",
        "    note: >-2",
        "      nested one",
        "      nested two",
        "---",
        "",
      ].join("\n")
    );

    expect(parsed?.data.literal).toBe("first\n  indented\n");
    expect(parsed?.data.folded).toBe("line one line two");
    expect(parsed?.data.reverse).toBe("final");
    expect(parsed?.data.metadata).toEqual({ note: "nested one nested two" });
  });

  it("ignores comments and blank lines and only strips separated inline comments", () => {
    const parsed = parseFrontmatter(
      [
        "---",
        "# leading comment",
        "",
        "name: foo # trailing comment",
        "sticky: bar#not-a-comment",
        'quoted: "keep # this"',
        "metadata:",
        "  # nested comment",
        "  value: \"1\" # strip me",
        "---",
        "",
      ].join("\n")
    );

    expect(parsed?.data).toEqual({
      name: "foo",
      sticky: "bar#not-a-comment",
      quoted: "keep # this",
      metadata: { value: "1" },
    });
  });

  it("handles CRLF delimiters while preserving body line endings", () => {
    const parsed = parseFrontmatter(
      "---\r\nname: x\r\nmetadata:\r\n  a: b\r\n---\r\nbody line\r\n"
    );
    expect(parsed?.data).toEqual({ name: "x", metadata: { a: "b" } });
    expect(parsed?.body).toBe("body line\r\n");
  });

  it("returns null without an opening frontmatter delimiter", () => {
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

  it("rejects duplicate top-level and nested keys", () => {
    expect(() => parseFrontmatter("---\nname: x\nname: y\n---\n")).toThrow(/duplicate key "name"/);
    expect(() => parseFrontmatter('---\nname: x\n"name": y\n---\n')).toThrow(
      /duplicate key "name"/
    );
    expect(() =>
      parseFrontmatter("---\nmetadata:\n  owner: a\n  owner: b\n---\n")
    ).toThrow(/duplicate key "owner"/);
  });

  it("rejects aliases, anchors, tags, and tabs", () => {
    expect(() => parseFrontmatter("---\na: &anchor value\n---\n")).toThrow(/aliases.*tags/);
    expect(() => parseFrontmatter("---\na: *anchor\n---\n")).toThrow(/aliases.*tags/);
    expect(() => parseFrontmatter("---\na: !custom value\n---\n")).toThrow(/aliases.*tags/);
    expect(() => parseFrontmatter("---\n\tname: x\n---\n")).toThrow(/tabs/);
    expect(() => parseFrontmatter('---\nname: "x\ty"\n---\n')).toThrow(/tabs/);
    expect(() => parseFrontmatter("---\na: |\n  x\ty\n---\n")).toThrow(/tabs/);
  });

  it("rejects sequences, nested flow collections, and deeper structures", () => {
    expect(() => parseFrontmatter("---\n- item\n---\n")).toThrow(/only mappings/);
    expect(() => parseFrontmatter("---\na: [one, two]\n---\n")).toThrow(/flow sequences/);
    expect(() =>
      parseFrontmatter("---\na: { nested: { deep: value } }\n---\n")
    ).toThrow(/nested flow collections/);
    expect(() =>
      parseFrontmatter("---\nmetadata:\n    nested:\n        deep: x\n---\n")
    ).toThrow(/deep structure/);
    expect(() => parseFrontmatter("---\nmetadata:\n    - item\n---\n")).toThrow(/only mappings/);
  });

  it("rejects malformed flow mappings, duplicate flow keys, and invalid block indicators", () => {
    expect(() => parseFrontmatter("---\na: { owner: one, owner: two }\n---\n")).toThrow(
      /duplicate key "owner"/
    );
    expect(() => parseFrontmatter("---\na: { owner }\n---\n")).toThrow(/no key separator/);
    expect(() => parseFrontmatter("---\na: { owner: [one] }\n---\n")).toThrow(/flow/);
    expect(() => parseFrontmatter("---\na: { owner: *alias }\n---\n")).toThrow(/aliases/);
    for (const header of ["|0", "|22", "|2+-", ">++"]) {
      expect(() => parseFrontmatter(`---\na: ${header}\n  text\n---\n`)).toThrow(
        /invalid block scalar header/
      );
    }
  });

  it("rejects malformed mappings and scalar indentation", () => {
    expect(() => parseFrontmatter("---\nkey:no-space\n---\n")).toThrow(/only mappings/);
    expect(() => parseFrontmatter("---\n: empty-key\n---\n")).toThrow(/empty key/);
    expect(() => parseFrontmatter("---\nname: x\n  bad: y\n---\n")).toThrow(/indentation/);
  });

  it("decodes double-quoted escapes and single-quoted doubled quotes", () => {
    const parsed = parseFrontmatter(
      '---\na: "line\\nbreak\\t\\"q\\""\nb: \'it\'\'s\'\nc: "\\u263a"\n---\n'
    );
    expect(parsed?.data.a).toBe('line\nbreak\t"q"');
    expect(parsed?.data.b).toBe("it's");
    expect(parsed?.data.c).toBe("☺");
  });

  it("rejects unterminated, malformed, and invalid Unicode quoted scalars", () => {
    expect(() => parseFrontmatter('---\na: "unterminated\n---\n')).toThrow(/unterminated/);
    expect(() => parseFrontmatter("---\na: 'unterminated\n---\n")).toThrow(/unterminated/);
    expect(() => parseFrontmatter('---\na: "bad" trailing\n---\n')).toThrow(
      /after quoted scalar/
    );
    expect(() => parseFrontmatter('---\na: "bad"#comment\n---\n')).toThrow(
      /after quoted scalar/
    );
    expect(() => parseFrontmatter('---\na: "\\q"\n---\n')).toThrow(/unsupported escape/);
    expect(() => parseFrontmatter('---\na: "\\U00110000"\n---\n')).toThrow(
      /Unicode code point/
    );
  });

  it("parses an empty value as null", () => {
    const parsed = parseFrontmatter("---\nname: x\ndescription:\n---\n");
    expect(parsed?.data.description).toBeNull();
  });
});
