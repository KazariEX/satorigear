import { type BlockLine, logicalLine } from "./lines.ts";

export interface BlockTokenRange {
  end: number;
  offset: number;
}

export interface BlockToken {
  offset: number;
  ranges?: BlockTokenRange[];
  text: string;
  type: string;
}

export interface BlockTokenChange {
  oldEnd: number;
  oldStart: number;
  tokens: readonly BlockToken[];
}

export function tokenStart(token: BlockToken): number {
  return token.ranges?.[0]?.offset ?? token.offset;
}

export function tokenEnd(token: BlockToken): number {
  return token.ranges?.at(-1)?.end ?? token.offset + token.text.length;
}

export function namedToken(type: string, text: string, offset: number, ranges?: BlockTokenRange[]): BlockToken {
  return {
    type,
    text,
    offset,
    ...(ranges?.length ? { ranges } : {}),
  };
}

export function structuralToken(type: string, offset: number, text = ""): BlockToken {
  return namedToken(type, text, offset);
}

export function logicalToken(
  type: string,
  source: string,
  lines: readonly BlockLine[],
  start: number,
  end: number,
): BlockToken {
  const count = end - start;
  const ranges = new Array<BlockTokenRange>(count);
  let canSliceSource = true;
  let previousLineEnd = 0;
  for (let index = 0; index < count; index++) {
    const line = lines[start + index];
    // Ranges retain the physical source spans even when the token text needs logical indentation repair.
    ranges[index] = { offset: line.start, end: line.next };

    canSliceSource &&= (
      // Tab overshoot is represented as virtual leading columns that do not exist in the source slice.
      (line.prefixColumns ?? 0) === 0 &&
      // A derived line may begin inside its physical line after a container marker was stripped.
      (line.start === 0 || source[line.start - 1] === "\n" || source[line.start - 1] === "\r") &&
      // Adjacent physical spans are required so a single slice cannot restore skipped container prefixes.
      (index === 0 || line.start === previousLineEnd)
    );
    previousLineEnd = line.next;
  }

  let text: string;
  if (canSliceSource) {
    // Physical top-level lines already form the logical token; one slice avoids rebuilding large verbatim blocks.
    text = source.slice(lines[start].start, lines[end - 1].next);
  }
  else {
    const logicalLines = new Array<string>(count);
    for (let index = 0; index < count; index++) {
      logicalLines[index] = logicalLine(source, lines[start + index]);
    }
    text = logicalLines.join("");
  }
  return namedToken(
    type,
    text,
    lines[start].start,
    ranges,
  );
}

export function createShiftedToken(token: BlockToken, delta: number): BlockToken {
  return {
    ...token,
    offset: token.offset + delta,
    ...token.ranges ? {
      ranges: token.ranges.map((range) => ({ offset: range.offset + delta, end: range.end + delta })),
    } : {},
  };
}

export function tokenEqualsAfterShift(previous: BlockToken, next: BlockToken, delta: number): boolean {
  if (previous.type !== next.type || previous.text !== next.text) {
    return false;
  }

  const previousLength = previous.ranges?.length ?? 1;
  const nextLength = next.ranges?.length ?? 1;

  if (previousLength !== nextLength) {
    return false;
  }

  for (let index = 0; index < previousLength; index++) {
    const previousRange = previous.ranges?.[index];
    const nextRange = next.ranges?.[index];
    const previousOffset = previousRange?.offset ?? previous.offset;
    const previousEnd = previousRange?.end ?? previous.offset + previous.text.length;
    const nextOffset = nextRange?.offset ?? next.offset;
    const nextEnd = nextRange?.end ?? next.offset + next.text.length;

    if (previousOffset + delta !== nextOffset || previousEnd + delta !== nextEnd) {
      return false;
    }
  }

  return true;
}

export function createTokenChange(
  previous: readonly BlockToken[],
  oldStart: number,
  oldEnd: number,
  replacement: readonly BlockToken[],
  delta: number,
): BlockTokenChange {
  // The scanner already identified the surgical window; only narrow changes within that window.
  const common = Math.min(oldEnd - oldStart, replacement.length);
  let start = 0;
  while (
    start < common &&
    tokenEqualsAfterShift(previous[oldStart + start], replacement[start], 0)
  ) {
    start++;
  }
  let suffix = 0;
  while (
    suffix < common - start &&
    tokenEqualsAfterShift(previous[oldEnd - 1 - suffix], replacement[replacement.length - 1 - suffix], delta)
  ) {
    suffix++;
  }
  return {
    oldStart: oldStart + start,
    oldEnd: oldEnd - suffix,
    tokens: replacement.slice(start, replacement.length - suffix),
  };
}
