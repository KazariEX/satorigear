import { Character } from "../constants/character.ts";
import { type BlockLines, lineIndentOffset, physicalColumnAt, trimLineWhitespaceStart } from "./lines.ts";
import type { BlockKind } from "../constants/block.ts";
import type { BlockTokenStream } from "./tokens.ts";

export interface Fence {
  indent: number;
  length: number;
  marker: number;
  offset: number;
  closingPattern: RegExp;
}

export interface FenceOptions {
  alternateMarker?: number;
  forbiddenInfoMarker: number;
  marker: number;
  minimumLength: number;
}

export function createFenceAt(options: FenceOptions): (
  source: string,
  lines: BlockLines,
  index: number,
  markerOffset: number,
) => Fence | undefined {
  const opening = createOpening(options.marker, options);
  const closing = createClosing(options.marker);
  const alternateOpening = options.alternateMarker && createOpening(options.alternateMarker, options) || void 0;
  const alternateClosing = options.alternateMarker && createClosing(options.alternateMarker) || void 0;

  return (source, lines, index, markerOffset) => {
    const marker = source.charCodeAt(markerOffset);
    if (marker !== options.marker && marker !== options.alternateMarker) {
      return;
    }
    const pattern = marker === options.marker ? opening : alternateOpening!;
    const headLength = options.minimumLength > 1 ? 2 : 1;
    if (headLength === 2 && source.charCodeAt(markerOffset + 1) !== marker) {
      return;
    }
    pattern.lastIndex = markerOffset + headLength;
    if (!pattern.test(source)) {
      return;
    }
    return {
      indent: lines.prefixColumns(index) + markerOffset - lines.start(index),
      length: pattern.lastIndex - markerOffset,
      marker,
      offset: markerOffset,
      closingPattern: marker === options.marker ? closing : alternateClosing!,
    };
  };
}

function createOpening(marker: number, options: FenceOptions): RegExp {
  const escaped = "\\u" + marker.toString(16).padStart(4, "0");
  const pattern = escaped + "{" + Math.max(0, options.minimumLength - 2) + ",}" + (
    marker === options.forbiddenInfoMarker
      ? "(?!" + escaped + ")(?=[^" + escaped + "\\r\\n]*(?:\\r|\\n|$))"
      : ""
  );
  return new RegExp(pattern, "y");
}

function createClosing(marker: number): RegExp {
  return new RegExp(`\\u${marker.toString(16).padStart(4, "0")}+[ \t]*`, "y");
}

export function closesFence(source: string, lines: BlockLines, index: number, fence: Fence): boolean {
  const lineStart = lines.start(index);
  const lineEnd = lines.end(index);
  if (lineEnd - lineStart < fence.length) {
    return false;
  }
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
  // The pattern accepts markers then whitespace; this probe enforces the minimum count.
  const lastRequired = offset + fence.length - 1;
  if (lastRequired >= lineEnd || source.charCodeAt(lastRequired) !== fence.marker) {
    return false;
  }
  const closing = fence.closingPattern;
  closing.lastIndex = offset;
  return closing.test(source) && closing.lastIndex === lineEnd;
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
