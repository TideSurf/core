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
  private counters: Map<string, number> = new Map();

  assign(mappedTag: string): string | undefined {
    const prefix = TAG_PREFIX[mappedTag];
    if (!prefix) return undefined;

    const count = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, count);
    return `${prefix}${count}`;
  }
}
