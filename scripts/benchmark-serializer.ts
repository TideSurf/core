/**
 * Performance benchmark for serializer optimization
 * Quadratic collectText → memoized O(n)
 */
import { collectTextMemoized, serialize } from "../src/parser/serializer.js";
import type { OSNode } from "../src/types.js";

function makeNode(
  tag: string,
  children: OSNode[],
  id?: string,
  text?: string,
): OSNode {
  return {
    tag,
    id,
    attributes: id ? { id } : {},
    children,
    text,
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

function generateDeepTree(depth: number): OSNode[] {
  if (depth === 0) return [makeText("Leaf text content")];

  return [
    makeNode("div", [
      makeNode("p", [
        makeText(`Paragraph text at depth ${depth}`),
        ...generateDeepTree(depth - 1),
      ]),
      makeNode("span", [makeText(`Span text at depth ${depth}`)]),
    ]),
  ];
}

function countNodes(nodes: OSNode[]): number {
  let count = 0;
  for (const node of nodes) {
    count++;
    count += countNodes(node.children);
  }
  return count;
}

// Benchmark collectText with memoization
console.log("\n" + "=".repeat(60));
console.log("  SERIALIZER PERFORMANCE BENCHMARK (HIGH-001)");
console.log("=".repeat(60));
console.log("\nTesting collectText memoization\n");

const testCases = [
  { depth: 10, name: "Small (depth 10)" },
  { depth: 50, name: "Medium (depth 50)" },
  { depth: 100, name: "Large (depth 100)" },
  { depth: 500, name: "XLarge (depth 500)" },
];

// Test repeated collectText calls (simulating many elements with shared subtrees)
for (const tc of testCases) {
  const nodes = generateDeepTree(tc.depth);
  const totalNodes = countNodes(nodes);
  const root = nodes[0];

  // Simulate calling collectText multiple times (as would happen in serialize)
  const runs = 100;
  const cache = new Map<OSNode, string>();

  const start = performance.now();
  for (let i = 0; i < runs; i++) {
    collectTextMemoized(root, cache);
  }
  const time = performance.now() - start;

  const avgPerCall = time / runs;

  console.log(
    `  ${tc.name.padEnd(20)} ${totalNodes.toLocaleString().padStart(6)} nodes  ${runs} calls  total=${time.toFixed(2)}ms  avg=${avgPerCall.toFixed(3)}ms/call`,
  );
}

console.log("\n" + "=".repeat(60));
console.log("  Benchmark complete");
console.log("=".repeat(60) + "\n");
