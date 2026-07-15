import { walkDOM } from "../../src/parser/dom-walker.js";
import { filterInteractive, filterMinimal } from "../../src/parser/mode-filter.js";
import { serialize } from "../../src/parser/serializer.js";
import { pruneToFit } from "../../src/parser/token-budget.js";
import { filterViewportOnly } from "../../src/parser/viewport-filter.js";
import type { CDPNode, OSNode } from "../../src/types.js";

function text(value: string): OSNode {
  return { tag: "#text", attributes: {}, children: [], text: value };
}

function node(tag: string, children: OSNode[], id?: string): OSNode {
  return {
    tag,
    id,
    attributes: id ? { id } : {},
    children,
  };
}

function medianRuntime(task: () => void, samples: number): number {
  task();
  const times: number[] = [];
  for (let index = 0; index < samples; index++) {
    const start = performance.now();
    task();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}

function expectNearLinear(small: number, large: number, inputGrowth: number): void {
  const ratio = large / Math.max(small, 0.05);
  expect(ratio).toBeLessThan(inputGrowth * 2.5);
}

function expectWithinCeiling(runtime: number): void {
  expect(runtime).toBeLessThan(5_000);
}

describe("parser scaling", () => {
  it("prunes large flat trees without quadratic serialization", () => {
    const build = (count: number) =>
      Array.from({ length: count }, (_, index) =>
        node("section", [text(`Content ${index} ${"x".repeat(40)}`)])
      );
    const small = build(4_096);
    const large = build(65_536);

    const smallTime = medianRuntime(() => {
      pruneToFit(small, { maxTokens: 2_000 });
    }, 3);
    const largeTime = medianRuntime(() => {
      pruneToFit(large, { maxTokens: 2_000 });
    }, 3);

    expectNearLinear(smallTime, largeTime, 16);
    expectWithinCeiling(largeTime);
  });

  it("filters interactive and minimal modes in near-linear time", () => {
    const build = (count: number) => [
      node(
        "main",
        Array.from({ length: count }, (_, index) =>
          index % 5 === 0
            ? node("button", [text(`Action ${index}`)], `B${index + 1}`)
            : node("section", [text(`Section ${index}`)])
        )
      ),
    ];
    const small = build(4_096);
    const large = build(65_536);

    const run = (nodes: OSNode[]) => {
      filterInteractive(nodes);
      filterMinimal(nodes);
    };
    const smallTime = medianRuntime(() => run(small), 3);
    const largeTime = medianRuntime(() => run(large), 3);

    expectNearLinear(smallTime, largeTime, 16);
    expectWithinCeiling(largeTime);
  });

  it("filters viewport-spanning containers in near-linear time", () => {
    const build = (count: number) => [
      {
        ...node(
          "main",
          Array.from({ length: count }, (_, index) => ({
            ...node("button", [text(`Button ${index}`)], `B${index + 1}`),
            visible: index % 20 === 0,
          }))
        ),
        visible: true,
      },
    ];
    const small = build(4_096);
    const large = build(65_536);

    const smallTime = medianRuntime(() => {
      filterViewportOnly(small);
    }, 3);
    const largeTime = medianRuntime(() => {
      filterViewportOnly(large);
    }, 3);

    expectNearLinear(smallTime, largeTime, 16);
    expectWithinCeiling(largeTime);
  });

  it("walks and serializes 65k DOM branches in near-linear time", () => {
    const build = (count: number): CDPNode => {
      let nextId = 0;
      const element = (
        nodeName: string,
        children: CDPNode[] = []
      ): CDPNode => ({
        nodeId: ++nextId,
        backendNodeId: nextId,
        nodeType: 1,
        nodeName,
        localName: nodeName.toLowerCase(),
        nodeValue: "",
        children,
      });
      const textNode = (value: string): CDPNode => ({
        nodeId: ++nextId,
        backendNodeId: nextId,
        nodeType: 3,
        nodeName: "#text",
        localName: "",
        nodeValue: value,
      });
      return element("#document", [
        element("HTML", [
          element(
            "BODY",
            Array.from({ length: count }, (_, index) =>
              element("DIV", [
                index % 5 === 0
                  ? element("BUTTON", [textNode(`Action ${index}`)])
                  : element("P", [textNode(`Content ${index}`)]),
              ])
            )
          ),
        ]),
      ]);
    };
    const small = build(4_096);
    const large = build(65_536);
    const run = (root: CDPNode) => {
      serialize(walkDOM(root).nodes);
    };

    const smallTime = medianRuntime(() => run(small), 3);
    const largeTime = medianRuntime(() => run(large), 3);

    expectNearLinear(smallTime, largeTime, 16);
    expectWithinCeiling(largeTime);
  });

  it("serializes and prunes link-heavy trees in near-linear time", () => {
    const build = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        ...node("link", [text(`Product ${index}`)], `L${index + 1}`),
        attributes: {
          id: `L${index + 1}`,
          href: `https://example.com/products/${index}?utm_source=bench&id=${index}`,
        },
      }));
    const small = build(4_096);
    const large = build(32_768);
    const run = (nodes: OSNode[]) => {
      serialize(nodes, 0, "https://example.com/catalog");
      pruneToFit(nodes, {
        maxTokens: 2_000,
        pageUrl: "https://example.com/catalog",
      });
    };

    const smallTime = medianRuntime(() => run(small), 3);
    const largeTime = medianRuntime(() => run(large), 3);

    expectNearLinear(smallTime, largeTime, 8);
    expectWithinCeiling(largeTime);
  });
});
