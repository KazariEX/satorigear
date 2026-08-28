import { Character } from "../constants/character.ts";
import { type BlockLines, lineContentEnd, lineIndentOffset } from "./lines.ts";

export interface Fence {
  indent: number;
  length: number;
  marker: number;
  offset: number;
}

export interface FenceRule {
  alternateMarker?: number;
  forbiddenInfoMarker: number;
  marker: number;
  minimumLength: number;
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
  if (marker !== rule.marker && marker !== rule.alternateMarker) {
    return;
  }
  let offset = markerOffset + 1;
  while (source.charCodeAt(offset) === marker) {
    offset++;
  }
  const length = offset - markerOffset;
  if (length < rule.minimumLength) {
    return;
  }
  if (marker === rule.forbiddenInfoMarker) {
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
  if (first !== fence.marker && first !== Character.Space) {
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
  // The first marker has already matched.
  offset++;
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

// Multiline anchors also recognize Unicode separators, which block scanning treats as content.
const fenceSpaceIndent = [
  /^(?<![\u2028\u2029]) /gm,
  /^(?<![\u2028\u2029]) {1,2}/gm,
  /^(?<![\u2028\u2029]) {1,3}/gm,
];
const sourceColumnFenceTabIndent = [
  /^(?<![\u2028\u2029])\t/gm,
  /^(?<![\u2028\u2029]) ?\t/gm,
  /^(?<![\u2028\u2029]) {0,2}\t/gm,
];

/** Extracts content from LF-normalized input, removing up to `block.indent` spaces per line. */
export function normalizedFenceContent(source: string, block: FencedBlock): string {
  const contentStart = source.indexOf("\n") + 1;
  if (!contentStart) {
    return "";
  }
  // Search before the closing line, whether or not its final LF is retained.
  const limit = block.closed
    ? source.lastIndexOf("\n", source.length - 2) + 1
    : source.length;
  const end = lineContentEnd(source, contentStart, limit);
  const content = source.slice(contentStart, end);
  return block.indent
    ? content.replace(fenceSpaceIndent[block.indent - 1], "")
    : content;
}

/** Extracts original source content, removing up to `block.indent` columns per line. */
export function sourceColumnFenceContent(source: string, block: FencedBlock): string {
  let contentStart = 0;
  while (contentStart < source.length && source[contentStart] !== "\n" && source[contentStart] !== "\r") {
    contentStart++;
  }
  if (contentStart < source.length) {
    contentStart += source[contentStart] === "\r" && source[contentStart + 1] === "\n" ? 2 : 1;
  }
  let limit = source.length;
  if (block.closed) {
    limit = lineContentEnd(source, contentStart, limit);
    // Walk from the closing fence back to the preceding source line ending.
    while (limit > contentStart && source[limit - 1] !== "\n" && source[limit - 1] !== "\r") {
      limit--;
    }
  }

  const end = lineContentEnd(source, contentStart, limit);
  let content = source.slice(contentStart, end);
  if (block.indent) {
    if (content.includes("\t")) {
      // Expand the first indentation tab to its stop so space removal retains its overshoot.
      content = content.replace(sourceColumnFenceTabIndent[block.indent - 1], "    ");
    }
    content = content.replace(fenceSpaceIndent[block.indent - 1], "");
  }
  return content;
}
