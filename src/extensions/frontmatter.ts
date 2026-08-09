export interface FrontmatterParse {
  readonly data: Readonly<Record<string, unknown>>;
  readonly body: string;
}

type MutableMap = Record<string, unknown>;

interface ParsedQuoted {
  readonly value: string;
  readonly end: number;
}

interface BlockHeader {
  readonly style: "literal" | "folded";
  readonly chomping: "clip" | "strip" | "keep";
  readonly indentation?: number;
}

interface ParsedBlockScalar {
  readonly value: string;
  readonly next: number;
}

interface ParsedMap {
  readonly value: MutableMap;
  readonly next: number;
}

const DOUBLE_QUOTE_ESCAPES: Readonly<Record<string, string>> = {
  " ": " ",
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
  N: "\u0085",
  _: "\u00a0",
  L: "\u2028",
  P: "\u2029",
};

function nullMap(): MutableMap {
  return Object.create(null) as MutableMap;
}

function parseDoubleQuoted(text: string, lineNumber: number): ParsedQuoted {
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
        const codePoint = Number.parseInt(hex, 16);
        if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
          throw new Error(
            `frontmatter line ${lineNumber}: invalid Unicode code point in double-quoted scalar`
          );
        }
        value += String.fromCodePoint(codePoint);
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

function parseSingleQuoted(text: string, lineNumber: number): ParsedQuoted {
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

function stripPlainComment(text: string): string {
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "#" && (index === 0 || text[index - 1] === " ")) {
      return text.slice(0, index).trim();
    }
  }
  return text.trim();
}

function parseQuoted(text: string, lineNumber: number): string {
  const parsed = text.startsWith('"')
    ? parseDoubleQuoted(text, lineNumber)
    : parseSingleQuoted(text, lineNumber);
  const rest = text.slice(parsed.end);
  if (rest.trim() !== "" && !/^ +#/.test(rest)) {
    throw new Error(`frontmatter line ${lineNumber}: unexpected content after quoted scalar`);
  }
  return parsed.value;
}

function parseFlowMapping(text: string, lineNumber: number): MutableMap {
  let quote: "single" | "double" | undefined;
  let closing = -1;
  for (let index = 1; index < text.length; index += 1) {
    const char = text[index];
    if (quote === "double") {
      if (char === "\\") index += 1;
      else if (char === '"') quote = undefined;
      continue;
    }
    if (quote === "single") {
      if (char === "'" && text[index + 1] === "'") index += 1;
      else if (char === "'") quote = undefined;
      continue;
    }
    if (char === '"') {
      quote = "double";
      continue;
    }
    if (char === "'") {
      quote = "single";
      continue;
    }
    if (char === "{" || char === "[") {
      throw new Error(
        `frontmatter line ${lineNumber}: nested flow collections are not supported`
      );
    }
    if (char === "]") {
      throw new Error(`frontmatter line ${lineNumber}: flow sequences are not supported`);
    }
    if (char === "#" && text[index - 1] === " ") {
      throw new Error(
        `frontmatter line ${lineNumber}: comments inside flow mappings are not supported`
      );
    }
    if (char === "}") {
      closing = index;
      break;
    }
  }
  if (quote !== undefined) {
    throw new Error(`frontmatter line ${lineNumber}: unterminated quoted flow scalar`);
  }
  if (closing === -1) {
    throw new Error(`frontmatter line ${lineNumber}: unterminated flow mapping`);
  }
  const rest = text.slice(closing + 1);
  if (rest.trim() !== "" && !/^ +#/.test(rest)) {
    throw new Error(`frontmatter line ${lineNumber}: unexpected content after flow mapping`);
  }

  const content = text.slice(1, closing);
  const entries: string[] = [];
  quote = undefined;
  let start = 0;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (quote === "double") {
      if (char === "\\") index += 1;
      else if (char === '"') quote = undefined;
      continue;
    }
    if (quote === "single") {
      if (char === "'" && content[index + 1] === "'") index += 1;
      else if (char === "'") quote = undefined;
      continue;
    }
    if (char === '"') quote = "double";
    else if (char === "'") quote = "single";
    else if (char === ",") {
      entries.push(content.slice(start, index));
      start = index + 1;
    }
  }
  entries.push(content.slice(start));

  const value = nullMap();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index].trim();
    if (entry === "") {
      const emptyMapping = entries.length === 1 && content.trim() === "";
      const trailingComma = index === entries.length - 1 && content.trimEnd().endsWith(",");
      if (emptyMapping || trailingComma) continue;
      throw new Error(`frontmatter line ${lineNumber}: empty flow mapping entry`);
    }

    let entryQuote: "single" | "double" | undefined;
    let colon = -1;
    for (let cursor = 0; cursor < entry.length; cursor += 1) {
      const char = entry[cursor];
      if (entryQuote === "double") {
        if (char === "\\") cursor += 1;
        else if (char === '"') entryQuote = undefined;
        continue;
      }
      if (entryQuote === "single") {
        if (char === "'" && entry[cursor + 1] === "'") cursor += 1;
        else if (char === "'") entryQuote = undefined;
        continue;
      }
      if (char === '"') entryQuote = "double";
      else if (char === "'") entryQuote = "single";
      else if (char === ":") {
        colon = cursor;
        break;
      }
    }
    if (colon === -1) {
      throw new Error(`frontmatter line ${lineNumber}: flow mapping entry has no key separator`);
    }
    const key = parseKey(entry.slice(0, colon), lineNumber);
    if (Object.hasOwn(value, key)) {
      throw new Error(`frontmatter line ${lineNumber}: duplicate key "${key}"`);
    }
    value[key] = parseScalar(entry.slice(colon + 1), lineNumber);
  }
  return value;
}

function parseNumber(value: string): number | undefined {
  const normalized = value.replaceAll("_", "");
  if (/^[-+]?0b[01]+$/i.test(normalized)) {
    const sign = normalized.startsWith("-") ? -1 : 1;
    return sign * Number.parseInt(normalized.replace(/^[-+]?0b/i, ""), 2);
  }
  if (/^[-+]?0o[0-7]+$/i.test(normalized)) {
    const sign = normalized.startsWith("-") ? -1 : 1;
    return sign * Number.parseInt(normalized.replace(/^[-+]?0o/i, ""), 8);
  }
  if (/^[-+]?0x[0-9a-f]+$/i.test(normalized)) {
    const sign = normalized.startsWith("-") ? -1 : 1;
    return sign * Number.parseInt(normalized.replace(/^[-+]?0x/i, ""), 16);
  }
  if (/^[-+]?[0-9][0-9_]*$/.test(value)) return Number(normalized);
  if (
    /^[-+]?(?:[0-9][0-9_]*(?:\.[0-9_]*)?|\.[0-9_]+)(?:e[-+]?[0-9][0-9_]*)?$/i.test(
      value
    ) &&
    (value.includes(".") || /e/i.test(value))
  ) {
    return Number(normalized);
  }
  if (/^[-+]?\.(?:inf|Inf|INF)$/.test(value)) return value.startsWith("-") ? -Infinity : Infinity;
  if (/^\.(?:nan|NaN|NAN)$/.test(value)) return Number.NaN;
  return undefined;
}

function parsePlainScalar(value: string, lineNumber: number): unknown {
  if (/^[*!&]/.test(value)) {
    throw new Error(`frontmatter line ${lineNumber}: YAML aliases, anchors, and tags are not allowed`);
  }
  if (value.startsWith("[")) {
    throw new Error(`frontmatter line ${lineNumber}: flow sequences are not supported`);
  }
  if (/^[|>]/.test(value)) {
    throw new Error(`frontmatter line ${lineNumber}: unsupported block scalar header`);
  }
  if (/^(?:null|Null|NULL|~)$/.test(value)) return null;
  if (/^(?:true|True|TRUE)$/.test(value)) return true;
  if (/^(?:false|False|FALSE)$/.test(value)) return false;
  const number = parseNumber(value);
  return number === undefined ? value : number;
}

function parseScalar(rawValue: string, lineNumber: number): unknown {
  const trimmed = rawValue.trim();
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    return parseQuoted(trimmed, lineNumber);
  }
  if (trimmed.startsWith("{")) return parseFlowMapping(trimmed, lineNumber);
  const plain = stripPlainComment(rawValue);
  if (plain === "") return null;
  return parsePlainScalar(plain, lineNumber);
}

function findMappingColon(line: string): number {
  let quote: "single" | "double" | undefined;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote === "double") {
      if (char === "\\") index += 1;
      else if (char === '"') quote = undefined;
      continue;
    }
    if (quote === "single") {
      if (char === "'" && line[index + 1] === "'") index += 1;
      else if (char === "'") quote = undefined;
      continue;
    }
    if (char === '"') {
      quote = "double";
      continue;
    }
    if (char === "'") {
      quote = "single";
      continue;
    }
    if (char === ":" && (line[index + 1] === undefined || line[index + 1] === " ")) {
      return index;
    }
  }
  return -1;
}

function parseKey(rawKey: string, lineNumber: number): string {
  const trimmed = rawKey.trim();
  if (trimmed === "") throw new Error(`frontmatter line ${lineNumber}: empty key`);
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    return parseQuoted(trimmed, lineNumber);
  }
  if (/^[*!&]|^[\-?:,[\]{}#|>@`]/.test(trimmed)) {
    throw new Error(`frontmatter line ${lineNumber}: unsupported YAML mapping key`);
  }
  return trimmed;
}

function splitKeyValue(line: string, lineNumber: number): { key: string; value: string } {
  const colon = findMappingColon(line);
  if (colon === -1) {
    throw new Error(
      `frontmatter line ${lineNumber}: unsupported YAML (only mappings are supported)`
    );
  }
  return {
    key: parseKey(line.slice(0, colon), lineNumber),
    value: line.slice(colon + 1),
  };
}

function parseBlockHeader(rawValue: string, lineNumber: number): BlockHeader | undefined {
  const value = stripPlainComment(rawValue);
  if (!value.startsWith("|") && !value.startsWith(">")) return undefined;
  const match = /^([|>])(?:(?:([1-9])([+-]?)|([+-])([1-9]?)))?$/.exec(value);
  if (match === null) {
    throw new Error(`frontmatter line ${lineNumber}: invalid block scalar header`);
  }
  const chomping = match[3] || match[4] || "";
  const indentation = match[2] || match[5];
  return {
    style: match[1] === "|" ? "literal" : "folded",
    chomping: chomping === "-" ? "strip" : chomping === "+" ? "keep" : "clip",
    ...(indentation === undefined || indentation === ""
      ? {}
      : { indentation: Number(indentation) }),
  };
}

function leadingSpaces(line: string): number {
  let count = 0;
  while (line[count] === " ") count += 1;
  return count;
}

function foldLines(lines: readonly string[]): string {
  if (lines.length === 0) return "";
  let trailingBlankLines = 0;
  while (trailingBlankLines < lines.length && lines[lines.length - 1 - trailingBlankLines] === "") {
    trailingBlankLines += 1;
  }
  const contentLength = lines.length - trailingBlankLines;
  if (contentLength === 0) return "\n".repeat(lines.length);

  let value = lines[0];
  for (let index = 1; index < contentLength; index += 1) {
    const previous = lines[index - 1];
    const current = lines[index];
    if (current === "") continue;
    if (previous === "") {
      let blankLines = 1;
      for (let cursor = index - 2; cursor >= 0 && lines[cursor] === ""; cursor -= 1) {
        blankLines += 1;
      }
      value += "\n".repeat(blankLines) + current;
    } else if (previous.startsWith(" ") || current.startsWith(" ")) {
      value += `\n${current}`;
    } else {
      value += ` ${current}`;
    }
  }
  return value + "\n".repeat(trailingBlankLines + 1);
}

function chompBlock(value: string, chomping: BlockHeader["chomping"]): string {
  if (chomping === "keep" || value === "") return value;
  const withoutTrailingBreaks = value.replace(/\n+$/, "");
  if (chomping === "strip" || withoutTrailingBreaks === "") return withoutTrailingBreaks;
  return `${withoutTrailingBreaks}\n`;
}

function parseBlockScalar(
  lines: readonly string[],
  start: number,
  parentIndent: number,
  header: BlockHeader
): ParsedBlockScalar {
  let contentIndent = header.indentation === undefined
    ? undefined
    : parentIndent + header.indentation;
  let boundary = lines.length;
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "") continue;
    const indent = leadingSpaces(line);
    if (indent <= parentIndent) {
      boundary = index;
      break;
    }
    if (contentIndent !== undefined && indent < contentIndent) {
      throw new Error(
        `frontmatter line ${index + 2}: block scalar content requires ${contentIndent}-space indentation`
      );
    }
    contentIndent ??= indent;
    break;
  }

  const content: string[] = [];
  if (contentIndent === undefined) {
    for (let index = start; index < boundary; index += 1) content.push("");
  } else {
    boundary = lines.length;
    for (let index = start; index < lines.length; index += 1) {
      const line = lines[index];
      if (line.trim() === "") {
        content.push("");
        continue;
      }
      const indent = leadingSpaces(line);
      if (indent < contentIndent) {
        boundary = index;
        break;
      }
      content.push(line.slice(contentIndent));
    }
  }

  const rendered = header.style === "literal" ? `${content.join("\n")}${content.length ? "\n" : ""}` : foldLines(content);
  return { value: chompBlock(rendered, header.chomping), next: boundary };
}

function nextContentLine(lines: readonly string[], start: number): number | undefined {
  for (let index = start; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (trimmed !== "" && !trimmed.startsWith("#")) return index;
  }
  return undefined;
}

function parseMap(
  lines: readonly string[],
  start: number,
  indent: number,
  depth: number
): ParsedMap {
  const value = nullMap();
  let index = start;
  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      index += 1;
      continue;
    }

    const actualIndent = leadingSpaces(line);
    if (actualIndent < indent) break;
    if (actualIndent > indent) {
      throw new Error(
        `frontmatter line ${index + 2}: unsupported deep structure or indentation (expected ${indent} spaces)`
      );
    }

    const lineNumber = index + 2;
    const { key, value: rawValue } = splitKeyValue(line.slice(indent), lineNumber);
    if (Object.hasOwn(value, key)) {
      throw new Error(`frontmatter line ${lineNumber}: duplicate key "${key}"`);
    }

    const blockHeader = parseBlockHeader(rawValue, lineNumber);
    if (blockHeader !== undefined) {
      const parsed = parseBlockScalar(lines, index + 1, indent, blockHeader);
      value[key] = parsed.value;
      index = parsed.next;
      continue;
    }

    if (stripPlainComment(rawValue) === "") {
      const childLine = nextContentLine(lines, index + 1);
      if (childLine !== undefined) {
        const childIndent = leadingSpaces(lines[childLine]);
        if (childIndent > indent) {
          if (depth >= 1) {
            throw new Error(
              `frontmatter line ${childLine + 2}: unsupported deep structure (only one nested mapping level is supported)`
            );
          }
          const child = parseMap(lines, index + 1, childIndent, depth + 1);
          value[key] = child.value;
          index = child.next;
          continue;
        }
      }
      value[key] = null;
      index += 1;
      continue;
    }

    value[key] = parseScalar(rawValue, lineNumber);
    index += 1;
  }
  return { value, next: index };
}

function parseBlock(lines: readonly string[]): Record<string, unknown> {
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].includes("\t")) {
      throw new Error(`frontmatter line ${index + 2}: tabs are not allowed`);
    }
  }
  const parsed = parseMap(lines, 0, 0, 0);
  if (parsed.next !== lines.length) {
    throw new Error(`frontmatter line ${parsed.next + 2}: unsupported YAML structure`);
  }
  return parsed.value;
}

export function parseFrontmatter(raw: string): FrontmatterParse | null {
  const firstBreak = raw.indexOf("\n");
  const firstLine = (firstBreak === -1 ? raw : raw.slice(0, firstBreak)).replace(/\r$/, "");
  if (firstLine !== "---") return null;
  if (firstBreak === -1) throw new Error("frontmatter block is not closed");

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
