import * as generatedInline from "../generated/inline.ts";
import type { EmittedArena } from "../emitted-parser.ts";
import type { TextEdit } from "../text-edit.ts";
import type { TokenChange } from "../token-change.ts";

export type InlineTokenStream = readonly number[];
export type InlineTokenChange = TokenChange<InlineTokenStream>;

export interface InlineSyntaxDocument {
  readonly arena: EmittedArena;
  readonly rootId: number;

  edit: (edits: readonly TextEdit[], change: InlineTokenChange) => void;
}

interface InlineTokenSegment {
  source: string;
  tokens: InlineTokenStream;
}

// The generated lexer, resolver, incremental parser, and projector share this one
// region-local record layout. Markdown inline tokens never need discontiguous ranges.
export const inlineTokenStride = generatedInline.packedTokenStride;
export const inlineSyntaxArena: EmittedArena = generatedInline.tree;
const inlineBoundaryKind = generatedInline.tokenKind("InlineBoundary");

export function inlineKind(type: string): number {
  return generatedInline.tokenKind(type);
}

export function tokenizeInline(source: string): InlineTokenStream {
  return generatedInline.tokenizePacked(source);
}

export function parseInline(source: string, tokens: InlineTokenStream): number {
  return generatedInline.parsePackedTokens(source, tokens, "InlineLines");
}

export function parseInlineForest(segments: readonly InlineTokenSegment[]): number {
  return generatedInline.parsePackedTokenSegments(segments, inlineBoundaryKind, "InlineForest");
}

export function createInlineSyntaxDocument(
  source: string,
  tokens: InlineTokenStream,
): InlineSyntaxDocument {
  const parser = generatedInline.createParser();
  const handle = parser.parsePackedTokens(source, tokens, "InlineLines");
  return {
    arena: parser.tree,
    get rootId() {
      return handle.root;
    },
    edit: (edits, change) => parser.editPackedTokens(handle, edits, change),
  };
}

export function inlineTokenCount(tokens: InlineTokenStream): number {
  return tokens.length / inlineTokenStride;
}

export function inlineTokenKind(tokens: InlineTokenStream, index: number): number {
  return tokens[index * inlineTokenStride];
}

export function inlineTokenStart(tokens: InlineTokenStream, index: number): number {
  return tokens[index * inlineTokenStride + 1];
}

export function inlineTokenEnd(tokens: InlineTokenStream, index: number): number {
  return tokens[index * inlineTokenStride + 2];
}

export function inlineTokenFlags(tokens: InlineTokenStream, index: number): number {
  return tokens[index * inlineTokenStride + 3];
}

export function inlineTokenText(source: string, tokens: InlineTokenStream, index: number): string {
  return source.slice(
    inlineTokenStart(tokens, index),
    inlineTokenEnd(tokens, index),
  );
}

export function appendInlineToken(
  target: number[],
  kind: number,
  start: number,
  end: number,
  flags = 0,
): void {
  target.push(kind, start, end, flags);
}

export function copyInlineToken(target: number[], tokens: InlineTokenStream, index: number): void {
  const offset = index * inlineTokenStride;
  for (let field = 0; field < inlineTokenStride; field++) {
    target.push(tokens[offset + field]);
  }
}

function tokenEqualsAfterShift(
  previousSource: string,
  previous: InlineTokenStream,
  previousIndex: number,
  nextSource: string,
  next: InlineTokenStream,
  nextIndex: number,
  delta: number,
): boolean {
  const previousStart = inlineTokenStart(previous, previousIndex);
  const previousEnd = inlineTokenEnd(previous, previousIndex);
  const nextStart = inlineTokenStart(next, nextIndex);
  const nextEnd = inlineTokenEnd(next, nextIndex);
  if (
    inlineTokenKind(previous, previousIndex) !== inlineTokenKind(next, nextIndex) ||
    inlineTokenFlags(previous, previousIndex) !== inlineTokenFlags(next, nextIndex) ||
    previousStart + delta !== nextStart ||
    previousEnd + delta !== nextEnd
  ) {
    return false;
  }
  return previousSource.slice(previousStart, previousEnd) === nextSource.slice(nextStart, nextEnd);
}

export function createInlineTokenChange(
  previousSource: string,
  previous: InlineTokenStream,
  nextSource: string,
  next: InlineTokenStream,
  delta: number,
): InlineTokenChange {
  const previousCount = inlineTokenCount(previous);
  const nextCount = inlineTokenCount(next);
  if (previousCount === 0) {
    return { oldStart: 0, oldEnd: 0, tokens: next };
  }
  if (nextCount === 0) {
    return { oldStart: 0, oldEnd: previousCount, tokens: next };
  }

  let start = 0;
  const common = Math.min(previousCount, nextCount);
  while (
    start < common &&
    tokenEqualsAfterShift(previousSource, previous, start, nextSource, next, start, 0)
  ) {
    start++;
  }

  let suffix = 0;
  while (
    suffix < common - start &&
    tokenEqualsAfterShift(
      previousSource,
      previous,
      previousCount - 1 - suffix,
      nextSource,
      next,
      nextCount - 1 - suffix,
      delta,
    )
  ) {
    suffix++;
  }

  return {
    oldStart: start,
    oldEnd: previousCount - suffix,
    tokens: next.slice(start * inlineTokenStride, (nextCount - suffix) * inlineTokenStride),
  };
}
