interface GraphemeSegment {
  segment: string;
  index: number;
}

const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter("en", { granularity: "grapheme" })
    : null;

function asciiPrefix(text: string, length: number): boolean {
  for (let index = 0; index < length; index++) {
    if (text.charCodeAt(index) > 0x7f) return false;
  }
  return true;
}

export function graphemeSegments(text: string): Iterable<GraphemeSegment> {
  if (segmenter) return segmenter.segment(text);
  return {
    *[Symbol.iterator]() {
      let index = 0;
      for (const segment of text) {
        yield { segment, index };
        index += segment.length;
      }
    },
  };
}

export function graphemeCount(text: string, stopAt = Infinity): number {
  const inspectedLength = Math.min(text.length, stopAt);
  if (asciiPrefix(text, inspectedLength)) {
    return inspectedLength;
  }
  let count = 0;
  for (const _part of graphemeSegments(text)) {
    count++;
    if (count >= stopAt) break;
  }
  return count;
}

export function truncateGraphemes(
  text: string,
  limit: number,
  options: {
    suffix?: string;
    preferWordBoundary?: boolean;
    measure?: (grapheme: string) => number;
    reservedSize?: number;
  } = {}
): string {
  if (limit <= 0) return "";
  if (options.measure) {
    let end = 0;
    let used = options.reservedSize ?? options.measure(options.suffix ?? "");
    let truncated = false;
    for (const part of graphemeSegments(text)) {
      const nextSize = options.measure(part.segment);
      if (used + nextSize > limit) {
        truncated = true;
        break;
      }
      used += nextSize;
      end = part.index + part.segment.length;
    }
    if (!truncated) return text;
    return `${text.slice(0, end).trimEnd()}${options.suffix ?? ""}`;
  }
  if (text.length <= limit) return text;
  if (asciiPrefix(text, Math.min(text.length, limit + 1))) {
    let end = limit;
    if (options.preferWordBoundary) {
      for (let index = limit - 1; index > 0; index--) {
        if (/\s/u.test(text[index])) {
          end = index;
          break;
        }
      }
    }
    const prefix = text.slice(0, end);
    return `${options.preferWordBoundary ? prefix.trimEnd() : prefix}${
      options.suffix ?? ""
    }`;
  }
  let count = 0;
  let lastWhitespace = -1;
  for (const part of graphemeSegments(text)) {
    if (count === limit) {
      const end =
        options.preferWordBoundary && lastWhitespace > 0
          ? lastWhitespace
          : part.index;
      const prefix = text.slice(0, end);
      return `${options.preferWordBoundary ? prefix.trimEnd() : prefix}${
        options.suffix ?? ""
      }`;
    }
    if (/\s/u.test(part.segment)) lastWhitespace = part.index;
    count++;
  }
  return text;
}

export function formatTruncation(count: string | number): string {
  return `[...${count} more sections truncated]`;
}
