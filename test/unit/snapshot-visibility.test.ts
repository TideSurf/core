import { walkDOM } from "../../src/parser/dom-walker.js";
import { serialize } from "../../src/parser/serializer.js";
import { filterViewportOnly } from "../../src/parser/viewport-filter.js";
import {
  decodeDOMSnapshot,
  SNAPSHOT_COMPUTED_STYLES,
  type DOMSnapshotData,
  type InspectionMarkerAttributes,
} from "../../src/cdp/snapshot.js";
import { ValidationError } from "../../src/errors.js";
import type { CDPNode } from "../../src/types.js";

const MARKERS: InspectionMarkerAttributes = {
  visible: "data-test-visible",
  hidden: "data-test-hidden",
  state: "data-test-state",
  text: "data-test-text",
};

const DEFAULT_STYLE: Record<string, string> = {
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

interface SpecNode {
  name: string;
  parent: number;
  value?: string;
  bounds?: [number, number, number, number];
  style?: Record<string, string>;
}

const PAGE: SpecNode[] = [
  { name: "#document", parent: -1, bounds: [0, 0, 400, 300] },
  { name: "HTML", parent: 0, bounds: [0, 0, 400, 300] },
  { name: "BODY", parent: 1, bounds: [0, 0, 400, 300] },
];

function buildSnapshot(specs: SpecNode[]): DOMSnapshotData {
  const strings: string[] = [];
  const indices = new Map<string, number>();
  const index = (value: string): number => {
    if (value === "") return -1;
    const existing = indices.get(value);
    if (existing !== undefined) return existing;
    strings.push(value);
    indices.set(value, strings.length - 1);
    return strings.length - 1;
  };

  const layoutNodeIndex: number[] = [];
  const layoutStyles: number[][] = [];
  const layoutBounds: number[][] = [];
  specs.forEach((spec, nodeIndex) => {
    if (!spec.bounds) return;
    layoutNodeIndex.push(nodeIndex);
    layoutBounds.push([...spec.bounds]);
    layoutStyles.push(
      SNAPSHOT_COMPUTED_STYLES.map((name) =>
        index(spec.style?.[name] ?? DEFAULT_STYLE[name])
      )
    );
  });

  return {
    strings,
    documents: [
      {
        documentURL: index("https://example.test/visibility"),
        title: index("Visibility fixture"),
        frameId: index("main-frame"),
        scrollOffsetX: 0,
        scrollOffsetY: 0,
        contentWidth: 400,
        contentHeight: 300,
        nodes: {
          parentIndex: specs.map((spec) => spec.parent),
          nodeType: specs.map((spec) =>
            spec.name === "#document" ? 9 : spec.name === "#text" ? 3 : 1
          ),
          nodeName: specs.map((spec) => index(spec.name)),
          nodeValue: specs.map((spec) => index(spec.value ?? "")),
          backendNodeId: specs.map((_spec, nodeIndex) => 100 + nodeIndex),
          attributes: specs.map(() => []),
        },
        layout: {
          nodeIndex: layoutNodeIndex,
          styles: layoutStyles,
          bounds: layoutBounds,
        },
      },
    ],
  };
}

function decode(specs: SpecNode[]) {
  return decodeDOMSnapshot(buildSnapshot(specs), {
    viewportWidth: 400,
    viewportHeight: 300,
    markerAttributes: MARKERS,
  });
}

function findBackend(root: CDPNode, id: number): CDPNode | undefined {
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.backendNodeId === id) return node;
    for (const child of node.children ?? []) stack.push(child);
  }
  return undefined;
}

function attributes(root: CDPNode, id: number): Record<string, string> {
  const flat = findBackend(root, id)?.attributes ?? [];
  const result: Record<string, string> = {};
  for (let index = 0; index < flat.length; index += 2) {
    result[flat[index]] = flat[index + 1];
  }
  return result;
}

describe("snapshot visibility clipping", () => {
  it("keeps fixed-position content that escapes an overflow-hidden ancestor", () => {
    const result = decode([
      ...PAGE,
      {
        name: "DIV",
        parent: 2,
        bounds: [0, 0, 400, 40],
        style: { "overflow-x": "hidden", "overflow-y": "hidden" },
      },
      {
        name: "BUTTON",
        parent: 3,
        bounds: [10, 100, 100, 30],
        style: { position: "fixed" },
      },
      { name: "#text", parent: 4, value: "Accept cookies", bounds: [12, 105, 80, 20] },
      { name: "BUTTON", parent: 3, bounds: [10, 200, 100, 30] },
      { name: "#text", parent: 6, value: "Overflowed", bounds: [12, 205, 80, 20] },
    ]);

    expect(attributes(result.root, 104)[MARKERS.visible]).toBe("1");
    expect(attributes(result.root, 104)[MARKERS.hidden]).toBeUndefined();
    expect(attributes(result.root, 106)[MARKERS.visible]).toBeUndefined();

    const walked = walkDOM(result.root, {
      markerAttributes: result.markerAttributes,
      viewportMarked: true,
    });
    const output = serialize(filterViewportOnly(walked.nodes).nodes, 0, result.url);
    expect(output).toContain("Accept cookies");
    expect(output).not.toContain("Overflowed");
  });

  it("clips absolute boxes by positioned overflow ancestors only", () => {
    const result = decode([
      ...PAGE,
      {
        name: "DIV",
        parent: 2,
        bounds: [0, 0, 400, 40],
        style: { "overflow-x": "hidden", "overflow-y": "hidden" },
      },
      {
        name: "BUTTON",
        parent: 3,
        bounds: [10, 100, 100, 30],
        style: { position: "absolute" },
      },
      {
        name: "DIV",
        parent: 2,
        bounds: [0, 150, 400, 40],
        style: {
          "overflow-x": "hidden",
          "overflow-y": "hidden",
          position: "relative",
        },
      },
      {
        name: "BUTTON",
        parent: 5,
        bounds: [10, 250, 100, 30],
        style: { position: "absolute" },
      },
    ]);

    expect(attributes(result.root, 104)[MARKERS.visible]).toBe("1");
    expect(attributes(result.root, 106)[MARKERS.visible]).toBeUndefined();
  });

  it("clips absolute boxes by paint-containing static ancestors", () => {
    const result = decode([
      ...PAGE,
      {
        name: "DIV",
        parent: 2,
        bounds: [0, 0, 400, 40],
        style: { contain: "paint" },
      },
      {
        name: "BUTTON",
        parent: 3,
        bounds: [10, 100, 100, 30],
        style: { position: "absolute" },
      },
    ]);

    expect(attributes(result.root, 104)[MARKERS.visible]).toBeUndefined();
  });

  it("hides zero-area polygon clip paths in any unit spelling", () => {
    const hiddenPolygons = [
      "polygon(0 0, 0 0, 0 0)",
      "polygon(0px 0px, 0px 0px, 0px 0px)",
      "polygon(0% 0%, 0% 0%, 0% 0%, 0% 0%)",
      "polygon(0px 0px, 100px 0px, 60px 0px)",
    ];
    for (const clipPath of hiddenPolygons) {
      const result = decode([
        ...PAGE,
        {
          name: "BUTTON",
          parent: 2,
          bounds: [10, 10, 100, 30],
          style: { "clip-path": clipPath },
        },
      ]);
      expect(attributes(result.root, 103)[MARKERS.hidden]).toBe("subtree");
      expect(attributes(result.root, 103)[MARKERS.visible]).toBeUndefined();
    }
  });

  it("keeps polygons with area or unparseable vertices visible", () => {
    for (const clipPath of [
      "polygon(0px 0px, 100px 0px, 50px 30px)",
      "polygon(evenodd, 0% 0%, 100% 0%, 50% 100%)",
      "polygon(calc(1px + 1%) 0px, 0px 0px, 0px 0px)",
    ]) {
      const result = decode([
        ...PAGE,
        {
          name: "BUTTON",
          parent: 2,
          bounds: [10, 10, 100, 30],
          style: { "clip-path": clipPath },
        },
      ]);
      expect(attributes(result.root, 103)[MARKERS.hidden]).toBeUndefined();
      expect(attributes(result.root, 103)[MARKERS.visible]).toBe("1");
    }
  });

  it("rejects non-positive viewport dimensions with a ValidationError", () => {
    for (const viewportWidth of [0, -5, Number.NaN]) {
      expect(() =>
        decodeDOMSnapshot(buildSnapshot(PAGE), {
          viewportWidth,
          viewportHeight: 300,
          markerAttributes: MARKERS,
        })
      ).toThrow(ValidationError);
    }
    expect(() =>
      decodeDOMSnapshot(buildSnapshot(PAGE), {
        viewportWidth: 400,
        viewportHeight: 0,
        markerAttributes: MARKERS,
      })
    ).toThrow("viewportHeight must be a positive number");
  });
});
