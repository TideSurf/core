import { describe, it, expect } from "vitest";
import { IDAssigner } from "../../src/parser/id-assigner.js";

describe("IDAssigner", () => {
  it("assigns sequential IDs with correct prefixes", () => {
    const assigner = new IDAssigner();
    expect(assigner.assign("link")).toBe("L1");
    expect(assigner.assign("link")).toBe("L2");
    expect(assigner.assign("button")).toBe("B1");
    expect(assigner.assign("input")).toBe("I1");
    expect(assigner.assign("link")).toBe("L3");
    expect(assigner.assign("button")).toBe("B2");
  });

  it("returns undefined for non-interactive tags", () => {
    const assigner = new IDAssigner();
    expect(assigner.assign("heading")).toBeUndefined();
    expect(assigner.assign("nav")).toBeUndefined();
    expect(assigner.assign("list")).toBeUndefined();
    expect(assigner.assign("item")).toBeUndefined();
    expect(assigner.assign("img")).toBeUndefined();
    expect(assigner.assign("section")).toBeUndefined();
  });

  it("assigns IDs for all interactive types", () => {
    const assigner = new IDAssigner();
    expect(assigner.assign("link")).toBe("L1");
    expect(assigner.assign("button")).toBe("B1");
    expect(assigner.assign("input")).toBe("I1");
    expect(assigner.assign("select")).toBe("S1");
    expect(assigner.assign("form")).toBe("F1");
    expect(assigner.assign("table")).toBe("T1");
    expect(assigner.assign("dialog")).toBe("D1");
  });

  it("resets counters", () => {
    const assigner = new IDAssigner();
    expect(assigner.assign("link")).toBe("L1");
    expect(assigner.assign("link")).toBe("L2");
    assigner.reset();
    expect(assigner.assign("link")).toBe("L1");
  });
});
