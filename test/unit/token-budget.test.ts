import { estimateTokens, pruneToFit } from "../../src/parser/token-budget.js";
import { pageHeader, serialize, wrapPage } from "../../src/parser/serializer.js";
import { filterMinimal } from "../../src/parser/mode-filter.js";
import type { OSNode } from "../../src/types.js";
import { ValidationError } from "../../src/errors.js";

describe("estimateTokens", () => {
  it("estimates tokens as length/4", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcdefgh")).toBe(2);
    expect(estimateTokens("a")).toBe(1); // ceil
  });

  it("uses custom charsPerToken", () => {
    expect(estimateTokens("abcdef", 3)).toBe(2);
  });

  it("rejects invalid token ratios", () => {
    expect(() => estimateTokens("text", 0)).toThrow(ValidationError);
    expect(() => estimateTokens("text", Number.NaN)).toThrow(ValidationError);
  });
});

describe("pruneToFit", () => {
  const makeText = (text: string): OSNode => ({
    tag: "#text",
    attributes: {},
    children: [],
    text,
  });

  const makeNode = (
    tag: string,
    children: OSNode[],
    opts?: { id?: string; visible?: boolean }
  ): OSNode => ({
    tag,
    id: opts?.id,
    attributes: opts?.id ? { id: opts.id } : {},
    children,
    visible: opts?.visible,
  });

  it("returns unchanged if under budget", () => {
    const nodes = [makeText("hello")];
    const result = pruneToFit(nodes, { maxTokens: 1000 });
    expect(result).toEqual(nodes);
  });

  it("rejects invalid budgets", () => {
    expect(() => pruneToFit([], { maxTokens: 0 })).toThrow(ValidationError);
    expect(() =>
      pruneToFit([], { maxTokens: 10, charsPerToken: Number.POSITIVE_INFINITY })
    ).toThrow(ValidationError);
  });

  it("prunes low-priority nodes first", () => {
    // Create enough content to exceed the budget
    const nodes = [
      makeNode("heading", [makeText("A fairly long title for testing purposes here")]),
      makeNode("button", [makeText("Click me")], { id: "B1" }),
      makeNode("heading", [makeText("Another section with a long heading to add tokens")]),
      makeNode("heading", [makeText("Yet another really long heading text for budget")]),
      makeNode("heading", [makeText("Extra content to push over the token limit clearly")]),
    ];

    // Budget tight enough to force pruning but leave room for button
    const result = pruneToFit(nodes, { maxTokens: 20 });

    // Interactive button should survive pruning (highest priority)
    const hasButton = JSON.stringify(result).includes("B1");
    expect(hasButton).toBe(true);
  });

  it("appends truncated indicator when nodes are removed", () => {
    const nodes = Array.from({ length: 20 }, (_, i) =>
      makeNode("heading", [makeText(`Heading ${i}`)])
    );

    const result = pruneToFit(nodes, { maxTokens: 10 });

    const truncated = result.find((n) => n.tag === "truncated");
    expect(truncated).toBeDefined();
    expect(Number(truncated!.attributes["count"])).toBeGreaterThan(0);
  });

  it("does not mutate input nodes", () => {
    const nodes = [
      makeNode("heading", [makeText("Title")]),
      makeNode("heading", [makeText("Sub")]),
    ];
    const originalJson = JSON.stringify(nodes);

    pruneToFit(nodes, { maxTokens: 5 });

    expect(JSON.stringify(nodes)).toBe(originalJson);
  });

  it("prioritizes visible nodes over non-visible", () => {
    const nodes = [
      makeNode("heading", [makeText("Invisible heading")]),
      makeNode("heading", [makeText("Visible heading")], { visible: true }),
    ];

    // Small budget to force one removal
    const result = pruneToFit(nodes, { maxTokens: 15 });

    // If pruning happened, visible node should survive
    const resultText = JSON.stringify(result);
    if (resultText.includes("truncated")) {
      expect(resultText).toContain("Visible heading");
    }
  });

  it("prunes children inside one dominant container", () => {
    const nodes = [
      makeNode(
        "main",
        Array.from({ length: 40 }, (_, i) =>
          makeNode("heading", [makeText(`Long low-priority content block ${i} `.repeat(8))])
        )
      ),
    ];

    const result = pruneToFit(nodes, { maxTokens: 120 });
    const serialized = serialize(result);

    expect(estimateTokens(serialized)).toBeLessThanOrEqual(140);
    expect(serialized).toContain("truncated");
  });

  it("recurses through dominant containers and copies only changed paths", () => {
    const button = makeNode("button", [makeText("Keep action")], { id: "B1" });
    const section = makeNode("section", [
      ...Array.from({ length: 30 }, (_, i) =>
        makeNode("heading", [makeText(`Low priority ${i} `.repeat(6))])
      ),
      button,
    ]);
    const main = makeNode("main", [section]);

    const result = pruneToFit([main], { maxTokens: 50 });
    const serialized = serialize(result);

    expect(serialized).toContain("B1");
    expect(serialized).toContain("truncated");
    expect(result[0]).not.toBe(main);
    expect(JSON.stringify(main)).not.toContain("truncated");

    const retainedButton = result[0].children[0].children.find((node) => node.id === "B1");
    expect(retainedButton).toBe(button);
  });

  it("keeps an interactive shell when its label exceeds the budget", () => {
    const button = makeNode("button", [makeText("Action label ".repeat(200))], {
      id: "B1",
    });
    const serialized = serialize(pruneToFit([button], { maxTokens: 20 }));
    expect(serialized).toContain("B1");
    expect(estimateTokens(serialized)).toBeLessThanOrEqual(20);
  });

  it("bounds escaped text and oversized accessible labels", () => {
    const escaped = serialize(
      pruneToFit([makeText("<".repeat(100))], { maxTokens: 25 })
    );
    expect(estimateTokens(escaped)).toBeLessThanOrEqual(25);

    const labelled: OSNode = {
      tag: "button",
      id: "B1",
      attributes: { "aria-label": "A".repeat(10_000) },
      children: [],
    };
    const labelledOutput = serialize(pruneToFit([labelled], { maxTokens: 20 }));
    expect(labelledOutput).toContain("B1");
    expect(estimateTokens(labelledOutput)).toBeLessThanOrEqual(20);
  });

  it("treats ECMAScript whitespace-only children as empty fallback text", () => {
    const whitespace =
      " \t\n\u00a0\u1680\u2000\u2028\u2029\u202f\u205f\u3000\ufeff";
    const button: OSNode = {
      tag: "button",
      id: "B1",
      attributes: { "aria-label": "Accessible action ".repeat(100) },
      children: [makeText(whitespace)],
    };

    const output = serialize(pruneToFit([button], { maxTokens: 10 }));

    expect(output).toBe("[B1]");
    expect(estimateTokens(output)).toBeLessThanOrEqual(10);
  });

  it("does not reveal an oversized link fallback after pruning its child text", () => {
    const link: OSNode = {
      tag: "link",
      id: "L1",
      attributes: {
        href: "https://example.com/long",
        "aria-label": "Accessible destination ".repeat(200),
        title: "Fallback destination ".repeat(200),
      },
      children: [makeText("Visible destination ".repeat(200))],
    };

    const output = serialize(pruneToFit([link], { maxTokens: 20 }));

    expect(output).toBe("[L1](example.com/long)");
    expect(estimateTokens(output)).toBeLessThanOrEqual(20);
  });

  it("does not reveal an oversized button fallback after pruning its child text", () => {
    const button: OSNode = {
      tag: "button",
      id: "B1",
      attributes: {
        "aria-label": "Accessible action ".repeat(200),
        title: "Fallback action ".repeat(200),
      },
      children: [makeText("Visible action ".repeat(200))],
    };

    const output = serialize(pruneToFit([button], { maxTokens: 10 }));

    expect(output).toBe("[B1]");
    expect(estimateTokens(output)).toBeLessThanOrEqual(10);
  });

  it("tolerates an unparseable pageUrl and still compresses hrefs", () => {
    const link: OSNode = {
      tag: "link",
      id: "L1",
      attributes: { href: "https://example.com/page?utm_source=x" },
      children: [makeText("Go")],
    };

    const output = serialize(
      pruneToFit([link], { maxTokens: 10, pageUrl: "example.com/page" }),
      0,
      "example.com/page"
    );

    expect(output).toBe("[L1](example.com/page) Go");
    expect(estimateTokens(output)).toBeLessThanOrEqual(10);
  });

  it("counts the title fallback when aria-label is empty", () => {
    const button: OSNode = {
      tag: "button",
      id: "B1",
      attributes: { "aria-label": "", title: "Fallback action ".repeat(10) },
      children: [],
    };
    const link: OSNode = {
      tag: "link",
      id: "L1",
      attributes: {
        href: "https://e.co/x",
        "aria-label": "",
        title: "Fallback destination ".repeat(10),
      },
      children: [],
    };

    for (const nodes of [[button], [link]]) {
      const output = serialize(pruneToFit(nodes, { maxTokens: 5 }));
      expect(estimateTokens(output)).toBeLessThanOrEqual(5);
    }
  });

  it("derives flag and placeholder sizes from serializer constants", () => {
    const collapsed: OSNode = {
      tag: "button",
      id: "B1",
      attributes: { "aria-expanded": "false" },
      children: [makeText("Menu item ".repeat(100))],
    };
    const collapsedOutput = serialize(pruneToFit([collapsed], { maxTokens: 20 }));
    expect(collapsedOutput).toContain("closed");
    expect(estimateTokens(collapsedOutput)).toBeLessThanOrEqual(20);

    const unknownFrame: OSNode = { tag: "iframe", attributes: {}, children: [] };
    expect(
      serialize(pruneToFit([unknownFrame], { maxTokens: 18, charsPerToken: 1 }))
    ).toBe("[iframe: unknown]");
    expect(
      serialize(pruneToFit([unknownFrame], { maxTokens: 17, charsPerToken: 1 }))
    ).toBe("");
  });

  it("keeps an empty-alt image whose serialized size exactly fits", () => {
    const img: OSNode = { tag: "img", attributes: { alt: "" }, children: [] };

    expect(
      serialize(pruneToFit([img], { maxTokens: 6, charsPerToken: 1 }))
    ).toBe("[img]");
  });

  it("costs optgroup labels and keeps select omissions visible", () => {
    const select: OSNode = {
      tag: "select",
      id: "S1",
      attributes: {},
      children: [
        {
          tag: "optgroup",
          attributes: { label: "Large group ".repeat(100) },
          children: [
            {
              tag: "option",
              attributes: {},
              children: [makeText("Large option ".repeat(100))],
            },
          ],
        },
      ],
    };

    const output = serialize(pruneToFit([select], { maxTokens: 30 }));

    expect(output).toContain("S1:select");
    expect(output).toContain("[...1 more sections truncated]");
    expect(estimateTokens(output)).toBeLessThanOrEqual(30);
  });

  it("accounts for normalized URLs and fixed iframe status text", () => {
    const unicodeLink: OSNode = {
      tag: "link",
      id: "L1",
      attributes: { href: `https://example.com/${"é".repeat(50)}` },
      children: [makeText("Go")],
    };
    const linkOutput = serialize(pruneToFit([unicodeLink], { maxTokens: 30 }));
    expect(linkOutput).toBe("[L1] Go");
    expect(estimateTokens(linkOutput)).toBeLessThanOrEqual(30);

    const inaccessibleFrame: OSNode = {
      tag: "iframe",
      attributes: { status: "inaccessible" },
      children: [],
    };
    const frameOutput = serialize(
      pruneToFit([inaccessibleFrame], { maxTokens: 5 })
    );
    expect(frameOutput).toBe("");
    expect(estimateTokens(frameOutput)).toBeLessThanOrEqual(5);
  });

  it("accounts for quote escaping and state flags on form controls", () => {
    const input: OSNode = {
      tag: "input",
      id: "I1",
      attributes: {
        id: "I1",
        placeholder: '"'.repeat(30),
        required: "",
      },
      children: [],
      state: ["disabled", "obscured"],
    };

    const output = serialize(pruneToFit([input], { maxTokens: 15 }));
    expect(output).toContain("I1");
    expect(estimateTokens(output)).toBeLessThanOrEqual(15);
  });

  it("recurses through any container that protects interactive descendants", () => {
    const label = makeNode("label", [
      makeText("Long label ".repeat(100)),
      makeNode("input", [], { id: "I1" }),
    ]);
    expect(serialize(pruneToFit([label], { maxTokens: 20 }))).toContain("I1");
  });

  it("accounts for indentation in deeply nested structural containers", () => {
    let nested = makeNode("button", [makeText("Action")], { id: "B1" });
    for (let depth = 0; depth < 20; depth++) {
      nested = makeNode("main", [nested]);
    }

    const serialized = serialize(pruneToFit([nested], { maxTokens: 50 }));

    expect(estimateTokens(serialized)).toBeLessThanOrEqual(50);
    expect(serialized).toContain("truncated");
  });

  it("counts indentation for direct text in nested containers", () => {
    let nested = makeText("<&x ".repeat(200));
    for (let depth = 0; depth < 12; depth++) {
      nested = makeNode("section", [nested]);
    }

    const serialized = serialize(pruneToFit([nested], { maxTokens: 60 }));

    expect(estimateTokens(serialized)).toBeLessThanOrEqual(60);
  });

  it("propagates fitted text indentation through nested landmarks", () => {
    const truncated = (count: number): OSNode => ({
      tag: "truncated",
      attributes: { count: String(count) },
      children: [],
    });
    const box = (tag: string, children: OSNode[]): OSNode => ({
      tag,
      attributes: {},
      children,
    });
    const tree = [
      box("section", [
        box("section", [
          box("nav", [
            box("main", [
              makeText("<&x ".repeat(3) + "<..."),
              box("main", [
                {
                  tag: "input",
                  id: "I98203",
                  attributes: {},
                  children: [],
                  visible: true,
                },
                makeText("<&x ".repeat(10) + "<&x..."),
                makeText("..."),
              ]),
              truncated(2),
            ]),
            truncated(4),
          ]),
          truncated(1),
        ]),
        truncated(2),
      ]),
      truncated(4),
    ];

    const output = serialize(pruneToFit(tree, { maxTokens: 103 }));

    expect(output.length).toBe(410);
    expect(estimateTokens(output)).toBe(103);
  });

  it("stays within budget across deterministic valid page-state shapes", () => {
    const pageUrl = "https://example.com/current";
    const fragments = ["plain ", "<&x ", 'quote" ', "🙂 ", "detail "];

    for (let fixture = 0; fixture < 1_000; fixture++) {
      let state = (0x5eed_0000 + fixture) >>> 0;
      let nextId = 0;
      const integer = (limit: number): number => {
        state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
        return state % limit;
      };
      const text = (): string => {
        const count = 1 + integer(24);
        let value = "";
        for (let index = 0; index < count; index++) {
          value += fragments[integer(fragments.length)];
        }
        return value.trimEnd();
      };
      const leaf = (): OSNode => {
        const kind = integer(7);
        if (kind === 0) return makeText(text());
        if (kind === 1) {
          return {
            tag: "truncated",
            attributes: { count: String(1 + integer(99)) },
            children: [],
          };
        }
        if (kind === 2) {
          const id = `I${++nextId}`;
          return {
            tag: "input",
            id,
            attributes: {
              id,
              placeholder: text(),
              ...(integer(2) === 0 ? { required: "" } : {}),
            },
            children: [],
            visible: integer(2) === 0,
          };
        }
        if (kind === 3 || kind === 4) {
          const tag = kind === 3 ? "button" : "link";
          const id = `${kind === 3 ? "B" : "L"}${++nextId}`;
          return {
            tag,
            id,
            attributes: {
              id,
              "aria-label": text(),
              ...(tag === "link"
                ? { href: `https://example.com/${text()}` }
                : {}),
            },
            children: integer(3) === 0 ? [] : [makeText(text())],
            visible: integer(2) === 0,
          };
        }
        if (kind === 5) {
          return {
            tag: "img",
            attributes: { alt: text() },
            children: [],
          };
        }
        return {
          tag: "iframe",
          attributes: { status: "inaccessible" },
          children: [],
        };
      };
      const node = (depth: number): OSNode => {
        if (depth === 0 || integer(4) === 0) return leaf();
        const tag = ["section", "nav", "main", "article", "aside"][
          integer(5)
        ];
        const childCount = 1 + integer(3);
        const children = Array.from({ length: childCount }, () =>
          node(depth - 1)
        );
        return {
          tag,
          attributes: integer(4) === 0 ? { "aria-label": text() } : {},
          children,
          ...(integer(5) === 0 ? { text: text() } : {}),
          visible: integer(2) === 0,
        };
      };

      const nodes = Array.from({ length: 1 + integer(3) }, () => node(4));
      const maxTokens = 8 + integer(160);
      const output = serialize(
        pruneToFit(nodes, { maxTokens, pageUrl }),
        0,
        pageUrl
      );
      if (output.length > maxTokens * 4) {
        throw new Error(
          `Fixture ${fixture} exceeded ${maxTokens * 4} characters with ${output.length}: ${JSON.stringify(nodes)}`
        );
      }
    }
  });

  it("counts minimal landmark summaries before pruning", () => {
    const nodes = Array.from({ length: 10 }, (_, index) =>
      makeNode("nav", [makeText(`Navigation ${index} ${"destination ".repeat(20)}`)])
    );
    const serialized = serialize(
      pruneToFit(filterMinimal(nodes), { maxTokens: 50 })
    );

    expect(estimateTokens(serialized)).toBeLessThanOrEqual(50);
    expect(serialized).toContain("truncated");
  });

  it("reserves header characters so wrapPage output stays within maxTokens", () => {
    const url = "https://example.com/page?id=123";
    const title = `Long title ${"with many words ".repeat(15)}`.trim();
    const scrollPosition = { scrollY: 250, scrollHeight: 3_000, viewportHeight: 800 };
    const header = pageHeader(url, title, scrollPosition);
    const maxTokens = 120;
    const nodes = [
      makeNode("button", [makeText("Keep action")], { id: "B1" }),
      ...Array.from({ length: 30 }, (_, index) =>
        makeNode("heading", [makeText(`Section ${index} ${"filler text ".repeat(15)}`)])
      ),
    ];

    const pruned = pruneToFit(nodes, {
      maxTokens,
      pageUrl: url,
      reservedChars: header.length + 2,
    });
    const output = wrapPage(serialize(pruned, 0, url), url, title, scrollPosition);

    // The header (title + URL meta) is charged against the budget before the
    // body is fitted, so the wrapped page never exceeds maxTokens * 4 chars.
    expect(output.length).toBeLessThanOrEqual(maxTokens * 4);
    expect(output).toContain("[B1]");
    expect(output).toContain("truncated");

    // Without the reservation the same body would push the page over budget.
    const unreserved = wrapPage(
      serialize(pruneToFit(nodes, { maxTokens, pageUrl: url }), 0, url),
      url,
      title,
      scrollPosition
    );
    expect(unreserved.length).toBeGreaterThan(maxTokens * 4);
  });

  it("drops the whole body when the reservation consumes the budget", () => {
    const nodes = [
      makeNode("button", [makeText("Keep action")], { id: "B1" }),
      makeNode("heading", [makeText("Some content")]),
    ];

    expect(pruneToFit(nodes, { maxTokens: 10, reservedChars: 1_000 })).toEqual([]);
  });

  it("weights each CJK character as charsPerToken units at the default ratio", () => {
    // At 4 chars/token, ten Japanese characters weigh 40 units: the whole
    // maxTokens=10 budget, so the text is shortened while 39 ASCII chars fit.
    const cjk = serialize(pruneToFit([makeText("あ".repeat(10))], { maxTokens: 10 }));
    expect(cjk).toBe("あ...");
    expect(serialize(pruneToFit([makeText("あ".repeat(9))], { maxTokens: 10 })))
      .toBe("あ".repeat(9));

    const latin = serialize(pruneToFit([makeText("a".repeat(41))], { maxTokens: 10 }));
    expect(latin).toBe("aaaaa...");
    expect(serialize(pruneToFit([makeText("a".repeat(39))], { maxTokens: 10 })))
      .toBe("a".repeat(39));
  });

  it("prunes a CJK-heavy tree much harder than an ASCII twin under one budget", () => {
    const asciiNodes = Array.from({ length: 8 }, (_, index) =>
      makeNode("heading", [makeText(`ascii block ${index} ${"x".repeat(40)}`)])
    );
    const japaneseNodes = Array.from({ length: 8 }, (_, index) =>
      makeNode("heading", [makeText(`ascii block ${index} ${"あ".repeat(40)}`)])
    );

    const asciiOutput = serialize(pruneToFit(asciiNodes, { maxTokens: 200 }));
    const japaneseOutput = serialize(pruneToFit(japaneseNodes, { maxTokens: 200 }));

    // Real tokenizers emit roughly one token per CJK character; weighting
    // CJK at charsPerToken units keeps the page near its real token budget.
    expect(asciiOutput).not.toContain("truncated");
    expect(japaneseOutput).toContain("truncated");
    expect(japaneseOutput.length).toBeLessThan(asciiOutput.length);
  });
});
