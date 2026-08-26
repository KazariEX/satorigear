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

export function indentColumns(source: string, line: BlockLine): number {
  let offset = line.start;
  let columns = line.prefixColumns ?? 0;
  while (offset < line.end) {
    if (source[offset] === " ") {
      offset++;
      columns++;
      continue;
    }
    if (source[offset] === "\t") {
      offset++;
      columns += 4 - (columns % 4);
      continue;
    }
    break;
  }
  return columns;
}

/** Returns the offset after up to three indent columns; tabs exceed this limit. */
export function indentOffset(source: string, line: BlockLine): number {
  let offset = line.start;
  const limit = offset + 3 - (line.prefixColumns ?? 0);
  while (offset < line.end && offset < limit && source[offset] === " ") {
    offset++;
  }
  return offset;
}

export function lineIndent(source: string, line: BlockLine): Indent | undefined {
  const offset = lineIndentOffset(source, line);
  if (offset !== -1) {
    return {
      columns: (line.prefixColumns ?? 0) + offset - line.start,
      offset,
    };
  }
}

/**
 * Returns the first content offset after consuming up to three indent columns.
 *
 * Unlike {@link indentOffset}, returns -1 when that boundary still points to a space or tab.
 * Inlining the scan improves repeated large-document block-dispatch throughput.
 */
export function lineIndentOffset(source: string, line: BlockLine): number {
  let offset = line.start;
  const limit = offset + 3 - (line.prefixColumns ?? 0);
  while (offset < line.end && offset < limit && source[offset] === " ") {
    offset++;
  }
  return source[offset] === " " || source[offset] === "\t" ? -1 : offset;
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
): { offset: number; prefixColumns: number } | undefined {
  let offset = line.start;
  let consumed = line.prefixColumns ?? 0;
  while (offset < line.end && consumed < columns) {
    if (source[offset] === " ") {
      consumed++;
    }
    else if (source[offset] === "\t") {
      consumed += 4 - (consumed % 4);
    }
    else {
      break;
    }
    offset++;
  }
  if (consumed >= columns) {
    return { offset, prefixColumns: consumed - columns };
  }
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
