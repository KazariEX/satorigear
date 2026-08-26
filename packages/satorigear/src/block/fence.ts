import { Character } from "../constants/character.ts";
import {
  type BlockLines,
  lineContentEnd,
  lineIndentOffset,
  removeIndent,
} from "./lines.ts";

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

export function fenceAt(
  source: string,
  lines: BlockLines,
  index: number,
  rule: FenceRule,
  markerOffset: number,
): Fence | undefined {
  const marker = source.charCodeAt(markerOffset);
  if (!rule.markers.includes(marker)) {
    return;
  }
  let offset = markerOffset;
  while (source.charCodeAt(offset) === marker) {
    offset++;
  }
  const length = offset - markerOffset;
  if (length < rule.minimumLength) {
    return;
  }
  if (rule.forbiddenInfoMarkers.includes(marker)) {
    const lineEnd = lines.end(index);
    while (offset < lineEnd) {
      if (source.charCodeAt(offset++) === marker) {
        return;
      }
    }
  }
  return {
    indent: lines.prefixColumns(index) + markerOffset - lines.start(index),
    marker,
    length,
    offset: markerOffset,
  };
}

export function closesFence(source: string, lines: BlockLines, index: number, fence: Fence): boolean {
  const lineStart = lines.start(index);
  const first = source.charCodeAt(lineStart);
  if (
    first !== fence.marker &&
    first !== Character.Space &&
    first !== Character.CharacterTabulation
  ) {
    return false;
  }
  let offset = lineStart;
  if (first !== fence.marker) {
    const contentOffset = lineIndentOffset(source, lines, index);
    if (contentOffset < 0 || source.charCodeAt(contentOffset) !== fence.marker) {
      return false;
    }
    offset = contentOffset;
  }
  const markerEnd = offset + fence.length;
  while (source.charCodeAt(offset) === fence.marker) {
    offset++;
  }
  if (offset < markerEnd) {
    return false;
  }
  const lineEnd = lines.end(index);
  while (offset < lineEnd && (source[offset] === " " || source[offset] === "\t")) {
    offset++;
  }
  return offset === lineEnd;
}

export function fencedBlock(
  source: string,
  lines: BlockLines,
  index: number,
  fence: Fence,
  closed: boolean,
): FencedBlock {
  let infoStart = fence.offset + fence.length;
  const lineEnd = lines.end(index);
  while (infoStart < lineEnd && (source[infoStart] === " " || source[infoStart] === "\t")) {
    infoStart++;
  }
  return {
    closed,
    indent: fence.indent,
    info: source.slice(infoStart, lineEnd),
    markerOffset: fence.offset - lines.start(index),
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
