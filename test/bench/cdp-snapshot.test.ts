import {
  decodeDOMSnapshot,
  SNAPSHOT_COMPUTED_STYLES,
  type DOMSnapshotData,
} from "../../src/cdp/snapshot.js";

const HIDDEN_STYLES = [
  "display",
  "visibility",
  "opacity",
  "content-visibility",
  "clip-path",
  "pointer-events",
] as const;

function snapshotFixture(rows: number, styles: readonly string[]): DOMSnapshotData {
  const strings: string[] = [];
  const stringIndices = new Map<string, number>();
  const stringIndex = (value: string): number => {
    const existing = stringIndices.get(value);
    if (existing !== undefined) return existing;
    const index = strings.length;
    strings.push(value);
    stringIndices.set(value, index);
    return index;
  };

  for (const value of [
    "",
    "https://benchmark.test/",
    "Snapshot benchmark",
    "main-frame",
    "#document",
    "HTML",
    "BODY",
    "DIV",
    "BUTTON",
    "#text",
    "INPUT",
    "SPAN",
    "type",
    "text",
    "Button",
    "Value",
    "Text",
    "block",
    "visible",
    "1",
    "none",
    "auto",
    "static",
  ]) {
    stringIndex(value);
  }

  const nodeType = [9, 1, 1];
  const parentIndex = [-1, 0, 1];
  const nodeName = [
    stringIndex("#document"),
    stringIndex("HTML"),
    stringIndex("BODY"),
  ];
  const nodeValue = [stringIndex(""), stringIndex(""), stringIndex("")];
  const backendNodeId = [1, 2, 3];
  const attributes: number[][] = [[], [], []];
  const inputIndices: number[] = [];
  const inputValues: number[] = [];
  const layoutNodeIndex = [1, 2];
  const layoutBounds = [[0, 0, 800, 600], [0, 0, 800, rows * 50]];
  const styleValues: Record<string, string> = {
    display: "block",
    visibility: "visible",
    opacity: "1",
    "content-visibility": "visible",
    "clip-path": "none",
    "overflow-x": "visible",
    "overflow-y": "visible",
    "pointer-events": "auto",
    contain: "none",
    clip: "auto",
    position: "static",
  };
  const encodedStyle = styles.map((name) => stringIndex(styleValues[name]));
  const layoutStyles: number[][] = [encodedStyle, encodedStyle];
  let backendId = 4;

  const addNode = (
    type: number,
    parent: number,
    name: string,
    value: string = "",
    attrs: number[] = []
  ): number => {
    const index = nodeType.length;
    nodeType.push(type);
    parentIndex.push(parent);
    nodeName.push(stringIndex(name));
    nodeValue.push(stringIndex(value));
    backendNodeId.push(backendId++);
    attributes.push(attrs);
    return index;
  };

  for (let row = 0; row < rows; row++) {
    const container = addNode(1, 2, "DIV");
    const button = addNode(1, container, "BUTTON");
    addNode(3, button, "#text", "Button");
    const input = addNode(1, container, "INPUT", "", [
      stringIndex("type"),
      stringIndex("text"),
    ]);
    inputIndices.push(input);
    inputValues.push(stringIndex("Value"));
    const span = addNode(1, container, "SPAN");
    addNode(3, span, "#text", "Text");

    for (const node of [container, button, input, span]) {
      layoutNodeIndex.push(node);
      layoutBounds.push([0, row * 50, 800, 40]);
      layoutStyles.push(encodedStyle);
    }
  }

  return {
    documents: [{
      documentURL: stringIndex("https://benchmark.test/"),
      title: stringIndex("Snapshot benchmark"),
      frameId: stringIndex("main-frame"),
      nodes: {
        parentIndex,
        nodeType,
        nodeName,
        nodeValue,
        backendNodeId,
        attributes,
        inputValue: { index: inputIndices, value: inputValues },
      },
      layout: {
        nodeIndex: layoutNodeIndex,
        styles: layoutStyles,
        bounds: layoutBounds,
      },
      scrollOffsetX: 0,
      scrollOffsetY: 0,
      contentHeight: rows * 50,
    }],
    strings,
  };
}

function medianRuntime(operation: () => void): number {
  for (let index = 0; index < 3; index++) operation();
  const samples: number[] = [];
  for (let index = 0; index < 7; index++) {
    const start = performance.now();
    operation();
    samples.push(performance.now() - start);
  }
  samples.sort((left, right) => left - right);
  return samples[Math.floor(samples.length / 2)];
}

describe("CDP snapshot scaling", () => {
  it("decodes a 42k-node viewport snapshot within the linear-time budget", () => {
    const data = snapshotFixture(7_000, SNAPSHOT_COMPUTED_STYLES);
    const elapsed = medianRuntime(() => {
      decodeDOMSnapshot(data, {
        viewportWidth: 800,
        viewportHeight: 600,
        markViewport: true,
        markHidden: true,
        computedStyles: SNAPSHOT_COMPUTED_STYLES,
      });
    });

    expect(elapsed).toBeLessThan(150);
  });

  it("decodes a 42k-node hidden-only snapshot without viewport work", () => {
    const data = snapshotFixture(7_000, HIDDEN_STYLES);
    const elapsed = medianRuntime(() => {
      decodeDOMSnapshot(data, {
        viewportWidth: 800,
        viewportHeight: 600,
        markViewport: false,
        markHidden: true,
        computedStyles: HIDDEN_STYLES,
      });
    });

    expect(elapsed).toBeLessThan(100);
  });
});
