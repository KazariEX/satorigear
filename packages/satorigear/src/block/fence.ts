import {
  type BlockLine,
  lineIndent,
  removeIndent,
} from "./primitives.ts";

export interface Fence {
  length: number;
  marker: string;
  offset: number;
}

export interface FenceRule {
  forbiddenInfoMarkers: string;
  markers: string;
  minimumLength: number;
}

export type FenceIndentation = "columns" | "spaces";

export interface FencedBlock {
  closed: boolean;
  contentEnd: number;
  contentStart: number;
  indent: number;
  info: string;
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
  return { marker, length, offset: indent.offset };
}

export function closesFence(source: string, line: BlockLine, fence: Fence): boolean {
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

function lineContentEnd(source: string, start: number, end: number): number {
  if (end <= start) {
    return end;
  }
  if (source.charCodeAt(end - 1) === 10) {
    return end > start + 1 && source.charCodeAt(end - 2) === 13 ? end - 2 : end - 1;
  }
  return source.charCodeAt(end - 1) === 13 ? end - 1 : end;
}

export function readFencedBlock(source: string, rule: FenceRule): FencedBlock {
  if (!source) {
    throw new Error("Fenced block token is empty");
  }

  let openingEnd = 0;
  while (openingEnd < source.length && source[openingEnd] !== "\n" && source[openingEnd] !== "\r") {
    openingEnd++;
  }
  let contentStart = openingEnd;
  if (source[contentStart] === "\r") {
    contentStart += source[contentStart + 1] === "\n" ? 2 : 1;
  }
  else if (source[contentStart] === "\n") {
    contentStart++;
  }

  const fence = fenceAt(source, { start: 0, end: openingEnd, next: contentStart }, rule);
  if (!fence) {
    throw new Error("Fenced block token has no opening fence");
  }

  const finalLineEnd = lineContentEnd(source, 0, source.length);
  let finalLineStart = finalLineEnd;
  while (
    finalLineStart > 0 &&
    source[finalLineStart - 1] !== "\n" &&
    source[finalLineStart - 1] !== "\r"
  ) {
    finalLineStart--;
  }
  const closed = (
    finalLineStart >= contentStart &&
    closesFence(source, { start: finalLineStart, end: finalLineEnd, next: source.length }, fence)
  );

  let infoStart = fence.offset + fence.length;
  while (infoStart < openingEnd) {
    const code = source.charCodeAt(infoStart);
    if (code !== 32 && code !== 9) {
      break;
    }
    infoStart++;
  }
  return {
    closed,
    contentEnd: closed ? finalLineStart : source.length,
    contentStart,
    indent: fence.offset,
    info: source.slice(infoStart, openingEnd),
  };
}

export function fencedBlockContent(
  source: string,
  block: FencedBlock,
  indentation: FenceIndentation = "spaces",
): string {
  const end = lineContentEnd(source, block.contentStart, block.contentEnd);
  if (!block.indent) {
    return source.slice(block.contentStart, end);
  }

  const chunks: string[] = [];
  let lineStart = block.contentStart;
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
      while (contentStart - lineStart < block.indent && source.charCodeAt(contentStart) === 32) {
        contentStart++;
      }
      chunks.push(source.slice(contentStart, next));
    }
    lineStart = next;
  }
  return chunks.join("");
}
