import type { Token } from "monogram/gen-lexer.ts";

export interface TokenChange {
  oldEnd: number;
  oldStart: number;
  tokens: readonly Token[];
}

export function shiftedToken(token: Token, delta: number): Token {
  return {
    ...token,
    offset: token.offset + delta,
    ...(token.ranges ? {
      ranges: token.ranges.map((range) => ({ offset: range.offset + delta, end: range.end + delta })),
    } : {}),
  };
}

export function sameShiftedToken(previous: Token, next: Token, delta: number): boolean {
  if (previous.type !== next.type || previous.text !== next.text
    || previous.newlineBefore !== next.newlineBefore
    || previous.commentBefore !== next.commentBefore
    || previous.multilineFlowBefore !== next.multilineFlowBefore) {
    return false;
  }
  const previousRanges = previous.ranges ?? [{ offset: previous.offset, end: previous.offset + previous.text.length }];
  const nextRanges = next.ranges ?? [{ offset: next.offset, end: next.offset + next.text.length }];
  return previousRanges.length === nextRanges.length && previousRanges.every((range, index) => (
    range.offset + delta === nextRanges[index].offset && range.end + delta === nextRanges[index].end
  ));
}

export function changedTokenRange(previous: readonly Token[], next: readonly Token[], delta: number): TokenChange {
  const common = Math.min(previous.length, next.length);
  let start = 0;
  while (start < common && sameShiftedToken(previous[start], next[start], 0)) {
    start++;
  }
  let suffix = 0;
  while (suffix < common - start
    && sameShiftedToken(previous[previous.length - 1 - suffix], next[next.length - 1 - suffix], delta)) {
    suffix++;
  }
  return {
    oldStart: start,
    oldEnd: previous.length - suffix,
    tokens: next.slice(start, next.length - suffix),
  };
}
