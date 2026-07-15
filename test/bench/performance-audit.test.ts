import { filterInteractive, filterMinimal } from "../../src/parser/mode-filter.js";
import { pruneToFit } from "../../src/parser/token-budget.js";
import { filterViewportOnly } from "../../src/parser/viewport-filter.js";
import type { OSNode } from "../../src/types.js";

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

function medianRuntime(task: () => void, samples: number = 5): number {
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

describe("parser scaling", () => {
  it("prunes large flat trees without quadratic serialization", () => {
    const build = (count: number) =>
      Array.from({ length: count }, (_, index) =>
        node("section", [text(`Content ${index} ${"x".repeat(40)}`)])
      );
    const small = build(2_000);
    const large = build(8_000);

    const smallTime = medianRuntime(() => {
      pruneToFit(small, { maxTokens: 2_000 });
    });
    const largeTime = medianRuntime(() => {
      pruneToFit(large, { maxTokens: 2_000 });
    });

    expectNearLinear(smallTime, largeTime, 4);
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
    const small = build(2_000);
    const large = build(8_000);

    const run = (nodes: OSNode[]) => {
      filterInteractive(nodes);
      filterMinimal(nodes);
    };
    const smallTime = medianRuntime(() => run(small));
    const largeTime = medianRuntime(() => run(large));

    expectNearLinear(smallTime, largeTime, 4);
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
    const small = build(2_000);
    const large = build(8_000);

    const smallTime = medianRuntime(() => {
      filterViewportOnly(small);
    });
    const largeTime = medianRuntime(() => {
      filterViewportOnly(large);
    });

    expectNearLinear(smallTime, largeTime, 4);
  });
});
