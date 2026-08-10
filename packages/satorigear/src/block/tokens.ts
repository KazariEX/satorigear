import { type BlockLine, logicalLine } from "./lines.ts";
import type { TokenChange } from "../syntax-protocol.ts";

export interface BlockTokenRange {
  end: number;
  offset: number;
}

export interface BlockToken {
  commentBefore: boolean;
  k: number;
  multilineFlowBefore: boolean;
  newlineBefore: boolean;
  offset: number;
  ranges?: BlockTokenRange[];
  t: number;
  text: string;
  type: string;
}

export type BlockTokenChange = TokenChange<readonly BlockToken[]>;

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
    k: 0,
    t: 0,
    newlineBefore: false,
    commentBefore: false,
    multilineFlowBefore: false,
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
  if (
    previous.type !== next.type ||
    previous.text !== next.text ||
    previous.newlineBefore !== next.newlineBefore ||
    previous.commentBefore !== next.commentBefore ||
    previous.multilineFlowBefore !== next.multilineFlowBefore
  ) {
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
  next: readonly BlockToken[],
  delta: number,
): BlockTokenChange {
  if (previous.length === 0) {
    return { oldStart: 0, oldEnd: 0, tokens: next };
  }
  if (next.length === 0) {
    return { oldStart: 0, oldEnd: previous.length, tokens: next };
  }

  const common = Math.min(previous.length, next.length);
  let start = 0;
  while (
    start < common &&
    tokenEqualsAfterShift(previous[start], next[start], 0)
  ) {
    start++;
  }
  let suffix = 0;
  while (
    suffix < common - start &&
    tokenEqualsAfterShift(previous[previous.length - 1 - suffix], next[next.length - 1 - suffix], delta)
  ) {
    suffix++;
  }
  return {
    oldStart: start,
    oldEnd: previous.length - suffix,
    tokens: next.slice(start, next.length - suffix),
  };
}
