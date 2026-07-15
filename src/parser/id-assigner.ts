import type { IDPrefixMap } from "../types.js";

/**
 * Tag → ID prefix mapping. Only interactive elements get IDs.
 */
const TAG_PREFIX: IDPrefixMap = {
  link: "L",
  button: "B",
  input: "I",
  select: "S",
  form: "F",
  table: "T",
  dialog: "D",
};

/**
 * Manages positional ID assignment for a single getState() call.
 * Counters reset each call.
 */
export class IDAssigner {
  private counters: Map<string, number> = new Map();

  /**
   * Get the next ID for a mapped tag, or undefined when the tag has no ID.
   */
  assign(mappedTag: string): string | undefined {
    const prefix = TAG_PREFIX[mappedTag];
    if (!prefix) return undefined;

    const count = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, count);
    return `${prefix}${count}`;
  }
}
