import { Character } from "../constants/character.ts";
import { type BlockLine, lineContentEnd, lineIndent, removeIndent } from "./lines.ts";

export interface Fence {
  indent: number;
  length: number;
  marker: number;
  offset: number;
}

export interface FenceRule {
  forbiddenInfoMarkers: readonly number[];
  markers: readonly number[];
  minimumLength: number;
}

export const enum FenceContentMode {
  NormalizedSpaces,
  SourceColumns,
}

// Scanning owns fence recognition; projection consumes this payload without recognizing it again.
export interface FencedBlock {
  closed: boolean;
  indent: number;
  info: string;
  markerOffset: number;
}

export function fenceAt(source: string, line: BlockLine, rule: FenceRule): Fence | undefined {
  const indent = lineIndent(source, line);
  if (!indent) {
    return;
  }
  const marker = source.charCodeAt(indent.offset);
  if (!rule.markers.includes(marker)) {
    return;
  }
  let offset = indent.offset;
  while (source.charCodeAt(offset) === marker) {
    offset++;
  }
  const length = offset - indent.offset;
  if (length < rule.minimumLength) {
    return;
  }
  if (rule.forbiddenInfoMarkers.includes(marker)) {
    while (offset < line.end) {
      if (source.charCodeAt(offset++) === marker) {
        return;
      }
    }
  }
  return { indent: indent.columns, marker, length, offset: indent.offset };
}

export function closesFence(source: string, line: BlockLine, fence: Fence): boolean {
  const first = source.charCodeAt(line.start);
  if (
    first !== fence.marker &&
    first !== Character.Space &&
    first !== Character.CharacterTabulation
  ) {
    return false;
  }
  let offset = line.start;
  if (first !== fence.marker) {
    const indent = lineIndent(source, line);
    if (!indent || source.charCodeAt(indent.offset) !== fence.marker) {
      return false;
    }
    offset = indent.offset;
  }
  const markerEnd = offset + fence.length;
  while (source.charCodeAt(offset) === fence.marker) {
    offset++;
  }
  if (offset < markerEnd) {
    return false;
  }
  while (offset < line.end && (source[offset] === " " || source[offset] === "\t")) {
    offset++;
  }
  return offset === line.end;
}

export function fencedBlock(source: string, line: BlockLine, fence: Fence, closed: boolean): FencedBlock {
  let infoStart = fence.offset + fence.length;
  while (infoStart < line.end && (source[infoStart] === " " || source[infoStart] === "\t")) {
    infoStart++;
  }
  return {
    closed,
    indent: fence.indent,
    info: source.slice(infoStart, line.end),
    markerOffset: fence.offset - line.start,
  };
}

export function fencedBlockContent(
  source: string,
  block: FencedBlock,
  mode: FenceContentMode,
): string {
  let contentStart: number;
  let contentEnd = source.length;
  if (mode === FenceContentMode.NormalizedSpaces) {
    // Code input is normalized before projection, so native LF searches can locate
    // its opening and closing lines without walking their contents in JavaScript.
    contentStart = source.indexOf("\n") + 1;
    if (!contentStart) {
      return "";
    }
    if (block.closed) {
      // Search before the closing line, whether or not its final LF is retained.
      contentEnd = source.lastIndexOf("\n", source.length - 2) + 1;
    }
  }
  else {
    contentStart = 0;
    while (contentStart < source.length && source[contentStart] !== "\n" && source[contentStart] !== "\r") {
      contentStart++;
    }
    if (contentStart < source.length) {
      contentStart += source[contentStart] === "\r" && source[contentStart + 1] === "\n" ? 2 : 1;
    }
    if (block.closed) {
      contentEnd = lineContentEnd(source, contentStart, contentEnd);
      while (
        contentEnd > contentStart &&
        source[contentEnd - 1] !== "\n" &&
        source[contentEnd - 1] !== "\r"
      ) {
        contentEnd--;
      }
    }
  }

  const end = lineContentEnd(source, contentStart, contentEnd);
  if (!block.indent) {
    return source.slice(contentStart, end);
  }
  const chunks: string[] = [];
  let lineStart = contentStart;
  while (lineStart < end) {
    const lf = source.indexOf("\n", lineStart);
    const cr = source.indexOf("\r", lineStart);
    const lineEnd = Math.min(lf < 0 ? end : lf, cr < 0 ? end : cr, end);
    let next = lineEnd;
    if (next < end) {
      next += source[next] === "\r" && source[next + 1] === "\n" ? 2 : 1;
    }
    if (mode === FenceContentMode.SourceColumns) {
      chunks.push(removeIndent(source.slice(lineStart, next), block.indent));
    }
    else {
      let start = lineStart;
      while (start - lineStart < block.indent && source.charCodeAt(start) === Character.Space) {
        start++;
      }
      chunks.push(source.slice(start, next));
    }
    lineStart = next;
  }
  return chunks.join("");
}
