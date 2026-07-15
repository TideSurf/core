import { walkDOM } from "../../src/parser/dom-walker.js";
import { serialize } from "../../src/parser/serializer.js";
import { filterViewportOnly } from "../../src/parser/viewport-filter.js";
import type { CDPConnection } from "../../src/cdp/connection.js";
import {
  captureDOMSnapshot,
  decodeDOMSnapshot,
  SNAPSHOT_COMPUTED_STYLES,
  type DOMSnapshotData,
  type InspectionMarkerAttributes,
} from "../../src/cdp/snapshot.js";
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

class StringTable {
  readonly values: string[] = [];
  private readonly indices = new Map<string, number>();

  index(value: string): number {
    if (value === "") return -1;
    const existing = this.indices.get(value);
    if (existing !== undefined) return existing;
    const index = this.values.length;
    this.values.push(value);
    this.indices.set(value, index);
    return index;
  }

  attributes(values: string[]): number[] {
    return values.map((value) => this.index(value));
  }

  style(overrides: Record<string, string> = {}): number[] {
    return SNAPSHOT_COMPUTED_STYLES.map((name) =>
      this.index(overrides[name] ?? DEFAULT_STYLE[name])
    );
  }
}

function setStyle(
  data: DOMSnapshotData,
  layoutIndex: number,
  overrides: Record<string, string>
): void {
  const index = (value: string): number => {
    const existing = data.strings.indexOf(value);
    if (existing >= 0) return existing;
    return data.strings.push(value) - 1;
  };
  data.documents[0].layout.styles![layoutIndex] = SNAPSHOT_COMPUTED_STYLES.map(
    (name) => index(overrides[name] ?? DEFAULT_STYLE[name])
  );
}

function fixture(): DOMSnapshotData {
  const strings = new StringTable();
  const names = [
    "#document",
    "HTML",
    "BODY",
    "INPUT",
    "INPUT",
    "SELECT",
    "OPTION",
    "#text",
    "OPTION",
    "#text",
    "X-HOST",
    "BUTTON",
    "#text",
    "IFRAME",
    "DIV",
    "BUTTON",
    "#text",
    "DIV",
    "BUTTON",
    "#text",
    "BUTTON",
    "#text",
    "DIV",
    "BUTTON",
    "#text",
  ];
  const nodeType = names.map((name) =>
    name === "#document" ? 9 : name === "#text" ? 3 : 1
  );
  const parentIndex = [
    -1, 0, 1, 2, 2, 2, 5, 6, 5, 8, 2, 10, 11, 2, 2, 14, 15, 2, 17, 18,
    2, 20, 2, 22, 23,
  ];
  const attributes = names.map(() => [] as number[]);
  attributes[3] = strings.attributes(["id", "query", "value", "stale"]);
  attributes[4] = strings.attributes([
    "id",
    "toggle",
    "type",
    "checkbox",
    "checked",
    "",
  ]);
  attributes[6] = strings.attributes(["selected", ""]);
  attributes[13] = strings.attributes(["src", "child.html"]);
  attributes[20] = strings.attributes(["inert", ""]);

  const nodeValue = names.map(() => strings.index(""));
  nodeValue[7] = strings.index("First");
  nodeValue[9] = strings.index("Second");
  nodeValue[12] = strings.index("Shadow");
  nodeValue[16] = strings.index("Clipped");
  nodeValue[19] = strings.index("Hidden");
  nodeValue[21] = strings.index("Inert");
  nodeValue[24] = strings.index("Inset");

  const layoutNodeIndex = [
    0, 1, 2, 3, 4, 5, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22,
    23, 24,
  ];
  const layoutBounds = [
    [0, 0, 400, 500],
    [0, 0, 400, 500],
    [0, 0, 400, 500],
    [10, 10, 120, 20],
    [10, 40, 20, 20],
    [10, 70, 100, 30],
    [10, 105, 120, 30],
    [10, 105, 80, 20],
    [15, 108, 60, 15],
    [150, 100, 200, 100],
    [0, 140, 100, 40],
    [0, 210, 80, 20],
    [5, 212, 55, 15],
    [120, 140, 100, 40],
    [120, 140, 80, 20],
    [125, 142, 50, 15],
    [10, 260, 80, 20],
    [15, 262, 40, 15],
    [230, 140, 100, 40],
    [230, 140, 80, 20],
    [235, 142, 40, 15],
  ];
  const layoutStyles = layoutNodeIndex.map(() => strings.style());
  layoutStyles[10] = strings.style({
    "overflow-x": "hidden",
    "overflow-y": "hidden",
  });
  layoutStyles[13] = strings.style({ opacity: "0" });
  layoutStyles[16] = strings.style({ "pointer-events": "none" });
  layoutStyles[18] = strings.style({ "clip-path": "inset(100%)" });

  const childNames = ["#document", "HTML", "BODY", "BUTTON", "#text"];
  const childStyles = childNames.map(() => strings.style());
  return {
    strings: strings.values,
    documents: [
      {
        documentURL: strings.index("https://example.test/page"),
        title: strings.index("Snapshot fixture"),
        frameId: strings.index("main-frame"),
        scrollOffsetX: 0,
        scrollOffsetY: 0,
        contentWidth: 400,
        contentHeight: 500,
        nodes: {
          parentIndex,
          nodeType,
          nodeName: names.map((name) => strings.index(name)),
          nodeValue,
          backendNodeId: names.map((_name, index) => 100 + index),
          attributes,
          shadowRootType: {
            index: [11, 12],
            value: [strings.index("open"), strings.index("open")],
          },
          inputValue: {
            index: [3, 4],
            value: [strings.index("live query"), strings.index("on")],
          },
          inputChecked: { index: [] },
          optionSelected: { index: [8] },
          contentDocumentIndex: { index: [13], value: [1] },
        },
        layout: {
          nodeIndex: layoutNodeIndex,
          styles: layoutStyles,
          bounds: layoutBounds,
        },
      },
      {
        documentURL: strings.index("https://example.test/child.html"),
        title: strings.index("Child"),
        frameId: strings.index("child-frame"),
        scrollOffsetX: 0,
        scrollOffsetY: 0,
        contentWidth: 200,
        contentHeight: 100,
        nodes: {
          parentIndex: [-1, 0, 1, 2, 3],
          nodeType: [9, 1, 1, 1, 3],
          nodeName: childNames.map((name) => strings.index(name)),
          nodeValue: ["", "", "", "", "Child action"].map((value) =>
            strings.index(value)
          ),
          backendNodeId: [200, 201, 202, 203, 204],
          attributes: childNames.map(() => []),
        },
        layout: {
          nodeIndex: [0, 1, 2, 3, 4],
          styles: childStyles,
          bounds: [
            [0, 0, 200, 100],
            [0, 0, 200, 100],
            [0, 0, 200, 100],
            [10, 10, 90, 20],
            [15, 12, 70, 15],
          ],
        },
      },
    ],
  };
}

function attributes(node: { attributes?: string[] }): Record<string, string> {
  const result: Record<string, string> = {};
  for (let index = 0; index < (node.attributes?.length ?? 0); index += 2) {
    result[node.attributes![index]] = node.attributes![index + 1];
  }
  return result;
}

function findBackend(root: CDPNode, id: number): CDPNode | undefined {
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.backendNodeId === id) return node;
    for (const child of node.children ?? []) stack.push(child);
    if (node.contentDocument) stack.push(node.contentDocument);
  }
  return undefined;
}

describe("DOM snapshot decoder", () => {
  it("reconstructs form state, frames, flattened shadow content, and metadata", () => {
    const result = decodeDOMSnapshot(fixture(), {
      viewportWidth: 400,
      viewportHeight: 300,
      markerAttributes: MARKERS,
    });

    expect(result.url).toBe("https://example.test/page");
    expect(result.title).toBe("Snapshot fixture");
    expect(result.scrollHeight).toBe(500);

    const input = findBackend(result.root, 103)!;
    expect(attributes(input).value).toBe("live query");
    expect(attributes(input)[MARKERS.visible]).toBe("1");

    const checkbox = findBackend(result.root, 104)!;
    expect(attributes(checkbox).checked).toBeUndefined();
    expect(attributes(checkbox).value).toBeUndefined();
    expect(attributes(findBackend(result.root, 106)!).selected).toBeUndefined();
    expect(attributes(findBackend(result.root, 108)!).selected).toBe("");

    const shadowHost = findBackend(result.root, 110)!;
    expect(shadowHost.children?.[0].backendNodeId).toBe(111);
    expect(shadowHost.shadowRoots).toBeUndefined();

    const frame = findBackend(result.root, 113)!;
    expect(frame.contentDocument?.frameId).toBe("child-frame");
    expect(findBackend(frame.contentDocument!, 203)).toBeDefined();
  });

  it("feeds viewport, clipping, hidden, and state markers into walkDOM", () => {
    const result = decodeDOMSnapshot(fixture(), {
      viewportWidth: 400,
      viewportHeight: 300,
      markerAttributes: MARKERS,
    });
    const clipped = attributes(findBackend(result.root, 115)!);
    const hidden = attributes(findBackend(result.root, 117)!);
    const inset = attributes(findBackend(result.root, 122)!);
    const inert = attributes(findBackend(result.root, 120)!);
    expect(clipped[MARKERS.visible]).toBeUndefined();
    expect(hidden[MARKERS.hidden]).toBe("subtree");
    expect(inset[MARKERS.hidden]).toBe("subtree");
    expect(inert[MARKERS.state]).toBe("inert");

    const walked = walkDOM(result.root, {
      markerAttributes: result.markerAttributes,
      viewportMarked: true,
    });
    const output = serialize(filterViewportOnly(walked.nodes).nodes, 0, result.url);
    expect(output).toContain("live query");
    expect(output).toContain("Shadow");
    expect(output).toContain("Child action");
    expect(output).toContain("Second");
    expect(output).not.toContain("Clipped");
    expect(output).not.toContain("Hidden");
    expect(output).not.toContain("Inset");
  });

  it("allows descendants to restore pointer events unless an inert ancestor blocks them", () => {
    const data = fixture();
    const styles = data.documents[0].layout.styles!;
    const pointerEvents = SNAPSHOT_COMPUTED_STYLES.indexOf("pointer-events");
    styles[6][pointerEvents] = data.strings.indexOf("none");
    styles[7][pointerEvents] = data.strings.indexOf("auto");

    const result = decodeDOMSnapshot(data, {
      viewportWidth: 400,
      viewportHeight: 300,
      markerAttributes: MARKERS,
    });

    expect(attributes(findBackend(result.root, 111)!)[MARKERS.state]).toBeUndefined();
    expect(attributes(findBackend(result.root, 120)!)[MARKERS.state]).toBe("inert");
  });

  it("omits password values from attributes and live form state", () => {
    const data = fixture();
    const typeIndex = data.strings.indexOf("type");
    const passwordIndex = data.strings.push("password") - 1;
    data.documents[0].nodes.attributes![3].push(typeIndex, passwordIndex);

    const result = decodeDOMSnapshot(data, {
      viewportWidth: 400,
      viewportHeight: 300,
      markerAttributes: MARKERS,
    });

    expect(attributes(findBackend(result.root, 103)!).value).toBeUndefined();
  });

  it("preserves attributes named after Object prototype properties", () => {
    const data = fixture();
    const prototypeName = data.strings.push("__proto__") - 1;
    const prototypeValue = data.strings.push("prototype-value") - 1;
    const constructorName = data.strings.push("constructor") - 1;
    const constructorValue = data.strings.push("constructor-value") - 1;
    data.documents[0].nodes.attributes![22].push(
      prototypeName,
      prototypeValue,
      constructorName,
      constructorValue
    );

    const result = decodeDOMSnapshot(data, {
      viewportWidth: 400,
      viewportHeight: 300,
      markerAttributes: MARKERS,
    });

    expect(findBackend(result.root, 122)?.attributes).toContain("__proto__");
    expect(findBackend(result.root, 122)?.attributes).toContain("prototype-value");
    expect(findBackend(result.root, 122)?.attributes).toContain("constructor");
    expect(findBackend(result.root, 122)?.attributes).toContain("constructor-value");
  });

  it("clips descendants for paint containment and non-inset CSS clips", () => {
    for (const style of [
      { contain: "paint" },
      { "clip-path": "ellipse(50% 25%)" },
      { clip: "rect(0px 20px 40px 0px)", position: "absolute" },
    ]) {
      const data = fixture();
      setStyle(data, 18, style);
      data.documents[0].layout.bounds![19] = [350, 150, 20, 20];
      data.documents[0].layout.bounds![20] = [352, 152, 16, 16];

      const result = decodeDOMSnapshot(data, {
        viewportWidth: 400,
        viewportHeight: 300,
        markerAttributes: MARKERS,
      });

      expect(attributes(findBackend(result.root, 123)!)[MARKERS.visible]).toBeUndefined();
    }
  });

  it("uses each edge default for legacy clip auto values", () => {
    const data = fixture();
    setStyle(data, 18, {
      clip: "rect(auto auto auto auto)",
      position: "absolute",
    });

    const result = decodeDOMSnapshot(data, {
      viewportWidth: 400,
      viewportHeight: 300,
      markerAttributes: MARKERS,
    });

    expect(attributes(findBackend(result.root, 123)!)[MARKERS.visible]).toBe("1");
  });

  it("rejects oversized and structurally invalid snapshots", () => {
    expect(() =>
      decodeDOMSnapshot(fixture(), {
        viewportWidth: 400,
        viewportHeight: 300,
        maxNodes: 10,
      })
    ).toThrow("maximum node count");

    const malformed = fixture();
    malformed.documents[0].nodes.parentIndex![3] = 4;
    expect(() =>
      decodeDOMSnapshot(malformed, {
        viewportWidth: 400,
        viewportHeight: 300,
      })
    ).toThrow("invalid parent index");
  });
});

describe("DOM snapshot capture", () => {
  it("preflights without mutations and sends one snapshot request", async () => {
    const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
    let expression = "";
    const conn = {
      Runtime: {
        evaluate: async (params: { expression: string }) => {
          expression = params.expression;
          return {
            result: {
              value: {
                nodeCount: 30,
                characterCount: 1_000,
                viewportWidth: 400,
                viewportHeight: 300,
              },
            },
          };
        },
      },
      client: {
        send: async (method: string, params?: Record<string, unknown>) => {
          calls.push({ method, params });
          return fixture();
        },
      },
    } as unknown as CDPConnection;

    const result = await captureDOMSnapshot(conn, {
      markViewport: true,
      markHidden: true,
    });

    expect(expression).toContain("childNodes");
    expect(expression).toContain("shadowRoot");
    expect(expression).toContain("contentDocument");
    expect(expression).not.toContain("Node.ELEMENT_NODE");
    expect(expression).not.toContain("Node.TEXT_NODE");
    expect(expression).not.toContain("setAttribute");
    expect(expression).not.toContain("removeAttribute");
    expect(calls).toEqual([
      {
        method: "DOMSnapshot.captureSnapshot",
        params: {
          computedStyles: [...SNAPSHOT_COMPUTED_STYLES],
          includePaintOrder: false,
          includeDOMRects: false,
        },
      },
    ]);
    expect(result.root.nodeName).toBe("#document");
  });

  it("requests only styles used by non-viewport snapshots", async () => {
    const requests: Array<Record<string, unknown> | undefined> = [];
    const conn = {
      Runtime: {
        evaluate: async () => ({
          result: {
            value: {
              nodeCount: 30,
              characterCount: 1_000,
              viewportWidth: 400,
              viewportHeight: 300,
            },
          },
        }),
      },
      client: {
        send: async (_method: string, params?: Record<string, unknown>) => {
          requests.push(params);
          return fixture();
        },
      },
    } as unknown as CDPConnection;

    await captureDOMSnapshot(conn, {
      markViewport: false,
      markHidden: true,
    });
    await captureDOMSnapshot(conn, {
      markViewport: false,
      markHidden: false,
    });

    expect(requests.map((request) => request?.computedStyles)).toEqual([
      [
        "display",
        "visibility",
        "opacity",
        "content-visibility",
        "clip-path",
        "pointer-events",
      ],
      ["pointer-events"],
    ]);
  });

  it("stops before capture when the non-mutating preflight exceeds the limit", async () => {
    let captured = false;
    const conn = {
      Runtime: {
        evaluate: async () => ({
          result: {
            value: {
              nodeCount: 3,
              characterCount: 10,
              viewportWidth: 400,
              viewportHeight: 300,
            },
          },
        }),
      },
      client: {
        send: async () => {
          captured = true;
          return fixture();
        },
      },
    } as unknown as CDPConnection;

    await expect(
      captureDOMSnapshot(conn, {
        markViewport: true,
        markHidden: true,
        maxNodes: 2,
      })
    ).rejects.toThrow("maximum node count");
    expect(captured).toBe(false);
  });

  it("stops before capture when page content exceeds the character guard", async () => {
    let captured = false;
    const conn = {
      Runtime: {
        evaluate: async () => ({
          result: {
            value: {
              nodeCount: 3,
              characterCount: 16_000_001,
              viewportWidth: 400,
              viewportHeight: 300,
            },
          },
        }),
      },
      client: {
        send: async () => { captured = true; },
      },
    } as unknown as CDPConnection;

    await expect(captureDOMSnapshot(conn, {
      markViewport: true,
      markHidden: true,
    })).rejects.toThrow("exceed 16,000,000 characters");
    expect(captured).toBe(false);
  });
});
