import { Character } from "../constants/character.ts";
import { type BlockLine, lineContentEnd, lineIndent, removeIndent } from "./lines.ts";

export interface Fence {
  indent: number;
  length: number;
  marker: string;
  offset: number;
}

export interface FenceRule {
  forbiddenInfoMarkers: string;
  markers: string;
  minimumLength: number;
}

type FenceIndentation = "columns" | "spaces";

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
  const marker = source[indent.offset];
  if (!rule.markers.includes(marker)) {
    return;
  }
  let offset = indent.offset;
  while (source[offset] === marker) {
    offset++;
  }
  const length = offset - indent.offset;
  if (length < rule.minimumLength) {
    return;
  }
  if (rule.forbiddenInfoMarkers.includes(marker)) {
    while (offset < line.end) {
      if (source[offset++] === marker) {
        return;
      }
    }
  }
  return { indent: indent.columns, marker, length, offset: indent.offset };
}

export function closesFence(source: string, line: BlockLine, fence: Fence): boolean {
  const first = source[line.start];
  if (first !== fence.marker && first !== " " && first !== "\t") {
    return false;
  }
  const indent = lineIndent(source, line);
  if (!indent || source[indent.offset] !== fence.marker) {
    return false;
  }
  let offset = indent.offset;
  while (source[offset] === fence.marker) {
    offset++;
  }
  if (offset - indent.offset < fence.length) {
    return false;
  }
  while (offset < line.end && (source[offset] === " " || source[offset] === "\t")) {
    offset++;
  }
  return offset === line.end;
}

export function fencedBlock(source: string, line: BlockLine, fence: Fence, closed: boolean): FencedBlock {
  let infoStart = fence.offset + fence.length;
  while (infoStart < line.end) {
    const code = source.charCodeAt(infoStart);
    if (code !== Character.Space && code !== Character.CharacterTabulation) {
      break;
    }
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
  indentation: FenceIndentation = "spaces",
): string {
  let contentStart = 0;
  while (contentStart < source.length && source[contentStart] !== "\n" && source[contentStart] !== "\r") {
    contentStart++;
  }
  if (source[contentStart] === "\r") {
    contentStart += source[contentStart + 1] === "\n" ? 2 : 1;
  }
  else if (source[contentStart] === "\n") {
    contentStart++;
  }

  let contentEnd = source.length;
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
    if (next < end && source[next] === "\r") {
      next += source[next + 1] === "\n" ? 2 : 1;
    }
    else if (next < end && source[next] === "\n") {
      next++;
    }
    if (indentation === "columns") {
      chunks.push(removeIndent(source.slice(lineStart, next), block.indent));
    }
    else {
      let contentStart = lineStart;
      while (contentStart - lineStart < block.indent && source.charCodeAt(contentStart) === Character.Space) {
        contentStart++;
      }
      chunks.push(source.slice(contentStart, next));
    }
    lineStart = next;
  }
  return chunks.join("");
}
