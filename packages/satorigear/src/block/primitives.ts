import type { BlockToken, BlockTokenRange } from "./tokens.ts";

export interface BlockLine {
  end: number;
  lazy?: boolean;
  next: number;
  prefixColumns?: number;
  start: number;
}

export interface Indent {
  columns: number;
  offset: number;
}

export function indentOf(source: string, line: BlockLine, limit = Number.POSITIVE_INFINITY): Indent {
  let offset = line.start;
  let columns = line.prefixColumns ?? 0;
  while (offset < line.end && columns < limit) {
    if (source[offset] === " ") {
      offset++;
      columns++;
      continue;
    }
    if (source[offset] === "\t") {
      const width = 4 - (columns % 4);
      if (columns + width > limit) {
        break;
      }
      offset++;
      columns += width;
      continue;
    }
    break;
  }
  return { offset, columns };
}

export function isBlank(source: string, line: BlockLine): boolean {
  for (let offset = line.start; offset < line.end; offset++) {
    if (source[offset] !== " " && source[offset] !== "\t") {
      return false;
    }
  }
  return true;
}

export function named(type: string, text: string, offset: number, ranges?: BlockTokenRange[]): BlockToken {
  return {
    type,
    text,
    offset,
    k: 0,
    t: 0,
    newlineBefore: false,
    commentBefore: false,
    multilineFlowBefore: false,
    ...(ranges?.length ? { ranges } : {}),
  };
}

export function structural(type: string, offset: number, text = ""): BlockToken {
  return named(type, text, offset);
}

export function logicalToken(
  type: string,
  source: string,
  lines: readonly BlockLine[],
  start: number,
  end: number,
): BlockToken {
  const ranges = lines.slice(start, end).map((line) => ({ offset: line.start, end: line.next }));
  return named(
    type,
    lines.slice(start, end).map((line) => logicalLine(source, line)).join(""),
    ranges[0].offset,
    ranges,
  );
}

export function physicalColumnAt(source: string, offset: number): number {
  let start = offset;
  while (start > 0 && source[start - 1] !== "\n" && source[start - 1] !== "\r") {
    start--;
  }
  let column = 0;
  while (start < offset) {
    column += source[start] === "\t" ? 4 - (column % 4) : 1;
    start++;
  }
  return column;
}

function logicalLine(source: string, line: BlockLine): string {
  let result = " ".repeat(line.prefixColumns ?? 0);
  let offset = line.start;
  let logicalColumn = line.prefixColumns ?? 0;
  let physicalColumn = physicalColumnAt(source, offset);
  while (offset < line.end && logicalColumn < 4 && (source[offset] === " " || source[offset] === "\t")) {
    if (source[offset] === " ") {
      result += " ";
      logicalColumn++;
      physicalColumn++;
    }
    else {
      const logicalWidth = 4 - (logicalColumn % 4);
      const physicalWidth = 4 - (physicalColumn % 4);
      result += "\t" + " ".repeat(Math.max(0, physicalWidth - logicalWidth));
      logicalColumn += Math.max(logicalWidth, physicalWidth);
      physicalColumn += physicalWidth;
    }
    offset++;
  }
  return result + source.slice(offset, line.next);
}

export function lineIndent(source: string, line: BlockLine): Indent | null {
  const indent = indentOf(source, line, 3);
  if (source[indent.offset] === " " || source[indent.offset] === "\t") {
    return null;
  }
  return indent;
}

export function removeIndent(value: string, columns: number): string {
  let offset = 0;
  let consumed = 0;
  while (offset < value.length && consumed < columns) {
    if (value[offset] === " ") {
      consumed++;
    }
    else if (value[offset] === "\t") {
      consumed += 4 - (consumed % 4);
    }
    else {
      break;
    }
    offset++;
  }
  return " ".repeat(Math.max(0, consumed - columns)) + value.slice(offset);
}
