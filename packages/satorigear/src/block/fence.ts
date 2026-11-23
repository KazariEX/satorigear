import { Character } from "../constants/character.ts";
import { type BlockLines, physicalColumnAt, trimLineWhitespaceStart } from "./lines.ts";
import type { BlockStartRegistration } from "./profile.ts";

interface FenceOptions {
  marker: number;
  minimumLength: 2 | 3;
  normalizeEndings: boolean;
  allowMarkerInInfo: boolean;
}

interface FenceMatch {
  value: string;
  info: string;
  nextLine: number;
  end: number;
}

interface Fence extends Pick<BlockStartRegistration, "codes" | "interrupt"> {
  closingLineAt: (source: string, lines: BlockLines, open: number, limit: number, offset: number) => number | undefined;
  match: (source: string, lines: BlockLines, start: number, offset: number) => FenceMatch | undefined;
}

export function createFence(options: FenceOptions): Fence {
  const { marker, normalizeEndings } = options;
  const opening = createOpening(marker, options);
  const closing = createClosing(marker);

  // Block dispatch already matched the first marker.
  function openingEnd(source: string, markerOffset: number): number {
    if (
      source.charCodeAt(markerOffset + 1) === marker && (
        opening.lastIndex = markerOffset + 2, opening.test(source)
      )
    ) {
      return opening.lastIndex;
    }
    return -1;
  }

  return {
    codes: [marker],
    interrupt(source, lines, index, offset) {
      return openingEnd(source, offset) >= 0;
    },
    closingLineAt(source, lines, open, limit, offset) {
      const markerEnd = openingEnd(source, offset);
      if (markerEnd >= 0) {
        return findFenceClose(source, lines, open, limit, marker, markerEnd - offset, closing);
      }
    },
    match(source, lines, start, offset) {
      const markerEnd = openingEnd(source, offset);
      if (markerEnd < 0) {
        return;
      }
      const close = findFenceClose(source, lines, start, lines.length, marker, markerEnd - offset, closing);
      const indent = lines.prefixColumns(start) + offset - lines.start(start);
      const closed = close < lines.length;
      const last = closed ? close : close - 1;
      const content = lines.physicallyContiguous()
        ? physicalFenceContent(source, lines, start, close - 1, indent, normalizeEndings)
        : logicalFenceContent(source, lines, start, close - 1, closed, indent, normalizeEndings);
      const lineEnd = lines.end(start);
      const infoStart = trimLineWhitespaceStart(source, markerEnd, lineEnd);
      return {
        nextLine: last + 1,
        end: !closed && lines.next(last) === source.length ? source.length : lines.end(last),
        value: content,
        info: source.slice(infoStart, lineEnd),
      };
    },
  };
}

function createOpening(marker: number, options: FenceOptions): RegExp {
  const escaped = "\\u" + marker.toString(16).padStart(4, "0");
  const pattern = escaped + "{" + (options.minimumLength - 2) + ",}" + (
    !options.allowMarkerInInfo
      ? "(?=[^" + escaped + "\\r\\n]*(?:\\r|\\n|$))"
      : ""
  );
  return new RegExp(pattern, "y");
}

function createClosing(marker: number): RegExp {
  const escaped = "\\u" + marker.toString(16).padStart(4, "0");
  return new RegExp(escaped + "*[ \t]*", "y");
}

/** Returns the closing line, or the exclusive search limit for an unclosed fence. */
function findFenceClose(
  source: string,
  lines: BlockLines,
  open: number,
  limit: number,
  marker: number,
  length: number,
  closing: RegExp,
): number {
  for (let line = open + 1; line < limit; line++) {
    let offset = lines.start(line);
    const end = lines.end(line);
    if (end - offset < length) {
      continue;
    }
    let first = source.charCodeAt(offset);
    if (first === Character.Space) {
      const lastStart = Math.min(end - length, offset + 3 - lines.prefixColumns(line));
      while (first === Character.Space && offset < lastStart) {
        first = source.charCodeAt(++offset);
      }
    }
    if (first !== marker) {
      continue;
    }
    // The pattern accepts any run width. Check the last required marker first.
    if (source.charCodeAt(offset + length - 1) !== marker) {
      continue;
    }
    closing.lastIndex = offset + 1;
    if (closing.test(source) && closing.lastIndex === end) {
      return line;
    }
  }
  return limit;
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
  last: number,
  closed: boolean,
  indent: number,
  normalizeEndings: boolean,
): string {
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
