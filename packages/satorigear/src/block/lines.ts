import { Character } from "../constants/character.ts";
import type { SourceSpan } from "../source-view.ts";

export interface BlockLine extends SourceSpan {
  lazy?: boolean;
  next: number;
  prefixColumns?: number;
}

interface Indent {
  columns: number;
  offset: number;
}

export function firstLineIndexAtOrAfter(lines: readonly BlockLine[], offset: number): number {
  let low = 0;
  let high = lines.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (lines[middle].start < offset) {
      low = middle + 1;
    }
    else {
      high = middle;
    }
  }
  return low;
}

export function lineContentEnd(source: string, start: number, end: number): number {
  if (end <= start) {
    return end;
  }
  if (source.charCodeAt(end - 1) === Character.LineFeed) {
    return end - (
      end > start + 1 && source.charCodeAt(end - 2) === Character.CarriageReturn
        ? 2
        : 1
    );
  }
  return source.charCodeAt(end - 1) === Character.CarriageReturn ? end - 1 : end;
}

export function lineIndent(source: string, line: BlockLine): Indent | undefined {
  const indent = indentOf(source, line, 3);
  if (source[indent.offset] === " " || source[indent.offset] === "\t") {
    return;
  }
  return indent;
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

export function logicalLine(source: string, line: BlockLine): string {
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

export function contentAfterColumns(
  source: string,
  line: BlockLine,
  columns: number,
): { offset: number; prefixColumns: number } {
  let offset = line.start;
  let consumed = line.prefixColumns ?? 0;
  if (consumed >= columns) {
    return { offset, prefixColumns: consumed - columns };
  }
  while (offset < line.end && consumed < columns) {
    if (source[offset] === " ") {
      consumed++;
      offset++;
      continue;
    }
    if (source[offset] === "\t") {
      consumed += 4 - (consumed % 4);
      offset++;
      continue;
    }
    break;
  }
  return { offset, prefixColumns: Math.max(0, consumed - columns) };
}

export function normalizeLines(value: string): string {
  return value.includes("\r") ? value.replace(/\r\n|\r/g, "\n") : value;
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
