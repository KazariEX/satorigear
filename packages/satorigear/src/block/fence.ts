import { Character } from "../constants/character.ts";
import { type BlockLines, lineIndentOffset, physicalColumnAt, trimLineWhitespaceStart } from "./lines.ts";
import type { BlockKind } from "../constants/block.ts";
import type { BlockTokenStream } from "./tokens.ts";

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
  return trimLineWhitespaceStart(source, offset, lineEnd) === lineEnd;
}

// Multiline anchors also recognize Unicode separators, which remain literal content.
const fenceSpaceIndent = [
  /^(?<![\u2028\u2029]) /gm,
  /^(?<![\u2028\u2029]) {1,2}/gm,
  /^(?<![\u2028\u2029]) {1,3}/gm,
];
const fenceTabIndent = [
  /^(?<![\u2028\u2029])\t/gm,
  /^(?<![\u2028\u2029]) ?\t/gm,
  /^(?<![\u2028\u2029]) {0,2}\t/gm,
];

/** Publish literal body, info and source position; scan records retain consumed coverage. */
export function appendFencedToken(
  source: string,
  lines: BlockLines,
  tokens: BlockTokenStream,
  kind: BlockKind,
  start: number,
  end: number,
  fence: Fence,
  closed: boolean,
  normalizeEndings: boolean,
): void {
  const content = lines.physicallyContiguous()
    ? physicalFenceContent(source, lines, start, end - (closed ? 2 : 1), fence.indent, normalizeEndings)
    : logicalFenceContent(source, lines, start, end, closed, fence.indent, normalizeEndings);
  const lineEnd = lines.end(start);
  const infoStart = trimLineWhitespaceStart(source, fence.offset + fence.length, lineEnd);
  const consumedEnd = lines.next(end - 1);
  tokens.push(
    kind,
    fence.offset,
    closed || consumedEnd < source.length ? lines.end(end - 1) : consumedEnd,
    {
      text: content,
      value: source.slice(infoStart, lineEnd),
    },
  );
}

function physicalFenceContent(
  source: string,
  lines: BlockLines,
  start: number,
  last: number,
  indent: number,
  normalizeEndings: boolean,
): string {
  const firstOffset = lines.next(start);
  let content = source.slice(firstOffset, last > start ? lines.end(last) : firstOffset);
  if (normalizeEndings) {
    content = lines.normalizeLineEndings(content);
  }
  if (!indent) {
    return content;
  }
  if (content.includes("\t")) {
    content = content.replace(fenceTabIndent[indent - 1], "    ");
  }
  return content.replace(fenceSpaceIndent[indent - 1], "");
}

function logicalFenceContent(
  source: string,
  lines: BlockLines,
  start: number,
  end: number,
  closed: boolean,
  indent: number,
  normalizeEndings: boolean,
): string {
  let last = end - (closed ? 2 : 1);
  // A final empty projected row without an ending contributes no body line.
  if (!closed && last > start && lines.start(last) === lines.next(last) && !lines.prefixColumns(last)) {
    last--;
  }
  const parts: string[] = [];
  for (let index = start + 1; index <= last; index++) {
    let offset = lines.start(index);
    const lineEnd = lines.end(index);
    let columns = lines.prefixColumns(index);
    while (offset < lineEnd && columns < indent) {
      const code = source.charCodeAt(offset);
      if (code === Character.Space) {
        columns++;
      }
      else if (code === Character.CharacterTabulation) {
        columns += 4 - physicalColumnAt(source, offset) % 4;
      }
      else {
        break;
      }
      offset++;
    }
    parts.push(
      " ".repeat(Math.max(0, columns - indent)) + source.slice(offset, lineEnd) + (
        index < last
          ? normalizeEndings
            ? "\n"
            : source.slice(lineEnd, lines.next(index))
          : ""
      ),
    );
  }
  return parts.join("");
}
