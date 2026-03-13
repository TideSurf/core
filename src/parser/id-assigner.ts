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
   * Get the next ID for a given mapped tag, or undefined if the tag doesn't get an ID.
   */
  assign(mappedTag: string): string | undefined {
    const prefix = TAG_PREFIX[mappedTag];
    if (!prefix) return undefined;

    const count = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, count);
    return `${prefix}${count}`;
  }

  /**
   * Reset all counters (called at the start of each getState())
   */
  reset(): void {
    this.counters.clear();
  }
}
