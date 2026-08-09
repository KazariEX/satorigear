import type { Token } from "monogram/gen-lexer.ts";

export interface TokenChange<Tokens = readonly Token[]> {
  oldEnd: number;
  oldStart: number;
  tokens: Tokens;
}

export function createShiftedToken(token: Token, delta: number): Token {
  return {
    ...token,
    offset: token.offset + delta,
    ...token.ranges ? {
      ranges: token.ranges.map((range) => ({ offset: range.offset + delta, end: range.end + delta })),
    } : {},
  };
}

export function tokenEqualsAfterShift(previous: Token, next: Token, delta: number): boolean {
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

export function createTokenChange(previous: readonly Token[], next: readonly Token[], delta: number): TokenChange {
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
