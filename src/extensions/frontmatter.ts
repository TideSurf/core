export interface FrontmatterParse {
  readonly data: Readonly<Record<string, unknown>>;
  readonly body: string;
}

const DOUBLE_QUOTE_ESCAPES: Readonly<Record<string, string>> = {
  "0": "\0",
  a: "\x07",
  b: "\b",
  t: "\t",
  n: "\n",
  v: "\v",
  f: "\f",
  r: "\r",
  e: "\x1b",
  '"': '"',
  "/": "/",
  "\\": "\\",
};

function parseDoubleQuoted(text: string, lineNumber: number): { value: string; end: number } {
  let value = "";
  let index = 1;
  while (index < text.length) {
    const char = text[index];
    if (char === '"') return { value, end: index + 1 };
    if (char === "\\") {
      const escape = text[index + 1];
      if (escape === undefined) break;
      if (escape === "x" || escape === "u" || escape === "U") {
        const length = escape === "x" ? 2 : escape === "u" ? 4 : 8;
        const hex = text.slice(index + 2, index + 2 + length);
        if (hex.length !== length || !/^[0-9a-fA-F]+$/.test(hex)) {
          throw new Error(
            `frontmatter line ${lineNumber}: invalid \\${escape} escape in double-quoted scalar`
          );
        }
        value += String.fromCodePoint(parseInt(hex, 16));
        index += 2 + length;
        continue;
      }
      const mapped = DOUBLE_QUOTE_ESCAPES[escape];
      if (mapped === undefined) {
        throw new Error(
          `frontmatter line ${lineNumber}: unsupported escape \\${escape} in double-quoted scalar`
        );
      }
      value += mapped;
      index += 2;
      continue;
    }
    value += char;
    index += 1;
  }
  throw new Error(`frontmatter line ${lineNumber}: unterminated double-quoted scalar`);
}

function parseSingleQuoted(text: string, lineNumber: number): { value: string; end: number } {
  let value = "";
  let index = 1;
  while (index < text.length) {
    if (text[index] === "'") {
      if (text[index + 1] === "'") {
        value += "'";
        index += 2;
        continue;
      }
      return { value, end: index + 1 };
    }
    value += text[index];
    index += 1;
  }
  throw new Error(`frontmatter line ${lineNumber}: unterminated single-quoted scalar`);
}

function parseScalar(rawValue: string, lineNumber: number): string {
  const trimmed = rawValue.trim();
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    const parsed = trimmed.startsWith('"')
      ? parseDoubleQuoted(trimmed, lineNumber)
      : parseSingleQuoted(trimmed, lineNumber);
    const rest = trimmed.slice(parsed.end).trim();
    if (rest !== "" && !rest.startsWith("#")) {
      throw new Error(`frontmatter line ${lineNumber}: unexpected content after quoted scalar`);
    }
    return parsed.value;
  }
  const commentIndex = rawValue.indexOf(" #");
  const withoutComment = commentIndex === -1 ? rawValue : rawValue.slice(0, commentIndex);
  return withoutComment.trim();
}

function splitKeyValue(line: string, lineNumber: number): { key: string; value: string } {
  const colon = line.indexOf(":");
  const after = colon === -1 ? undefined : line[colon + 1];
  if (colon === -1 || (after !== undefined && after !== " ")) {
    throw new Error(
      `frontmatter line ${lineNumber}: unsupported YAML (only "key: value" mappings are supported)`
    );
  }
  const key = line.slice(0, colon).trim();
  if (key === "") {
    throw new Error(`frontmatter line ${lineNumber}: empty key`);
  }
  return { key, value: line.slice(colon + 1) };
}

function parseBlock(lines: readonly string[]): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  let mapKey: string | null = null;
  let mapEntries: Record<string, string> = {};
  let seqKey: string | null = null;
  let seqEntries: string[] = [];

  const finalizeMap = (): void => {
    if (mapKey === null) return;
    data[mapKey] = Object.keys(mapEntries).length > 0 ? { ...mapEntries } : "";
    mapKey = null;
    mapEntries = {};
  };
  const finalizeSeq = (): void => {
    if (seqKey === null) return;
    data[seqKey] = [...seqEntries];
    seqKey = null;
    seqEntries = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    // Line 1 of the document is the opening "---", so block lines start at 2.
    const lineNumber = index + 2;
    const line = lines[index];
    if (line.trim() === "") continue;
    const leading = /^[ \t]*/.exec(line)?.[0] ?? "";
    if (leading.includes("\t")) {
      throw new Error(`frontmatter line ${lineNumber}: tab indentation is not allowed`);
    }
    if (line.trimStart().startsWith("#")) continue;
    if (leading.length === 0) {
      finalizeMap();
      finalizeSeq();
      const { key, value } = splitKeyValue(line, lineNumber);
      const scalar = parseScalar(value, lineNumber);
      if (scalar === "") {
        mapKey = key;
        mapEntries = {};
      } else {
        data[key] = scalar;
      }
      continue;
    }
    if (leading === "  " && (mapKey !== null || seqKey !== null)) {
      const content = line.slice(2);
      if (content.startsWith("- ")) {
        if (mapKey !== null && Object.keys(mapEntries).length > 0) {
          throw new Error(
            `frontmatter line ${lineNumber}: a block cannot mix map entries and sequence items`
          );
        }
        seqKey ??= mapKey;
        mapKey = null;
        mapEntries = {};
        seqEntries.push(parseScalar(content.slice(2), lineNumber));
        continue;
      }
      if (seqKey !== null) {
        throw new Error(
          `frontmatter line ${lineNumber}: a block cannot mix sequence items and map entries`
        );
      }
      const { key, value } = splitKeyValue(content, lineNumber);
      mapEntries[key] = parseScalar(value, lineNumber);
      continue;
    }
    if (mapKey === null && seqKey === null) {
      throw new Error(
        `frontmatter line ${lineNumber}: indented content under a scalar key is not supported`
      );
    }
    throw new Error(`frontmatter line ${lineNumber}: nested blocks require exactly 2-space indentation`);
  }
  finalizeMap();
  finalizeSeq();
  return data;
}

export function parseFrontmatter(raw: string): FrontmatterParse | null {
  const firstBreak = raw.indexOf("\n");
  const firstLine = (firstBreak === -1 ? raw : raw.slice(0, firstBreak)).replace(/\r$/, "");
  if (firstLine !== "---") return null;
  if (firstBreak === -1) {
    throw new Error("frontmatter block is not closed");
  }
  const lines: string[] = [];
  let cursor = firstBreak + 1;
  for (;;) {
    const breakAt = raw.indexOf("\n", cursor);
    const end = breakAt === -1 ? raw.length : breakAt;
    const line = raw.slice(cursor, end).replace(/\r$/, "");
    if (line === "---") {
      const body = breakAt === -1 ? "" : raw.slice(breakAt + 1);
      return { data: parseBlock(lines), body };
    }
    if (breakAt === -1) break;
    lines.push(line);
    cursor = breakAt + 1;
  }
  throw new Error("frontmatter block is not closed");
}
