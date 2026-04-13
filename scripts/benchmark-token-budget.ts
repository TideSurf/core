/**
 * Performance benchmark for token-budget optimization
 * O(n²) → O(n log n) improvement
 */
import { pruneToFit } from "../src/parser/token-budget.js";
import type { OSNode } from "../src/types.js";

function makeNode(tag: string, children: OSNode[], id?: string): OSNode {
  return {
    tag,
    id,
    attributes: id ? { id } : {},
    children,
    visible: false,
  };
}

function makeText(text: string): OSNode {
  return {
    tag: "#text",
    attributes: {},
    children: [],
    text,
  };
}

function generateLargeTree(depth: number, breadth: number): OSNode[] {
  const nodes: OSNode[] = [];

  for (let i = 0; i < breadth; i++) {
    const children: OSNode[] = [];
    for (let j = 0; j < depth; j++) {
      children.push(
        makeNode(
          "heading",
          [makeText(`Heading ${i}-${j} with some text content here`)],
          j === 0 ? `H${i}` : undefined,
        ),
      );
      children.push(
        makeNode("paragraph", [
          makeText(
            `Paragraph ${i}-${j} with more content and text to fill space`,
          ),
        ]),
      );
      children.push(
        makeNode("button", [makeText(`Button ${i}-${j}`)], `B${i}-${j}`),
      );
    }
    nodes.push(makeNode("section", children, `S${i}`));
  }

  return nodes;
}

function countNodes(nodes: OSNode[]): number {
  let count = 0;
  for (const node of nodes) {
    count++;
    count += countNodes(node.children);
  }
  return count;
}

// Run benchmarks
console.log("\n" + "=".repeat(60));
console.log("  TOKEN BUDGET PERFORMANCE BENCHMARK (CRIT-003)");
console.log("=".repeat(60));
console.log("\nTesting O(n²) → O(n log n) optimization\n");

const testCases = [
  { depth: 10, breadth: 10, name: "Small (100 nodes)" },
  { depth: 20, breadth: 50, name: "Medium (1,000 nodes)" },
  { depth: 50, breadth: 100, name: "Large (5,000 nodes)" },
  { depth: 100, breadth: 100, name: "XLarge (10,000 nodes)" },
];

for (const tc of testCases) {
  const nodes = generateLargeTree(tc.depth, tc.breadth);
  const totalNodes = countNodes(nodes);

  // Warm up
  pruneToFit(nodes, { maxTokens: 100 });

  // Benchmark
  const runs = 5;
  const times: number[] = [];

  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    pruneToFit(nodes, { maxTokens: 100 });
    times.push(performance.now() - start);
  }

  const avg = times.reduce((a, b) => a + b, 0) / runs;
  const p50 = [...times].sort((a, b) => a - b)[Math.floor(runs / 2)];

  console.log(
    `  ${tc.name.padEnd(20)} ${totalNodes.toLocaleString().padStart(8)} nodes  avg=${avg.toFixed(2)}ms  p50=${p50.toFixed(2)}ms`,
  );

  // Assert performance target
  if (tc.name.includes("10,000") && avg > 100) {
    console.log(
      `    ⚠ WARNING: Expected <100ms for 10k nodes, got ${avg.toFixed(2)}ms`,
    );
  }
}

console.log("\n" + "=".repeat(60));
console.log("  Benchmark complete");
console.log("=".repeat(60) + "\n");
