import type { IDPrefixMap } from "../types.js";

const TAG_PREFIX: IDPrefixMap = {
  link: "L",
  button: "B",
  input: "I",
  select: "S",
  form: "F",
  table: "T",
  dialog: "D",
};

/** Assigns positional action IDs; counters reset for each page read. */
export class IDAssigner {
  private counters: Record<string, number> = {
    L: 0,
    B: 0,
    I: 0,
    S: 0,
    F: 0,
    T: 0,
    D: 0,
  };

  assign(mappedTag: string): string | undefined {
    const prefix = TAG_PREFIX[mappedTag];
    if (!prefix) return undefined;

    const count = ++this.counters[prefix];
    return `${prefix}${count}`;
  }
}
