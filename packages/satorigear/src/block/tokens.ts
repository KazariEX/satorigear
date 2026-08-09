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

export interface LinkDefinitionFields {
  destination: string;
  label: string;
  markerOffset: number;
  normalizedLabel: string;
  title: string | null;
}

export interface LinkDefinitionOpenToken extends BlockToken {
  linkDefinition: LinkDefinitionFields;
}

export type BlockTokenChange = TokenChange<readonly BlockToken[]>;

export function linkDefinitionFields(token: BlockToken): LinkDefinitionFields {
  const fields = (token as Partial<LinkDefinitionOpenToken>).linkDefinition;
  if (token.type !== "LinkDefinitionOpen" || !fields) {
    throw new Error("Expected LinkDefinitionOpen token to contain parsed fields");
  }
  return fields;
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
