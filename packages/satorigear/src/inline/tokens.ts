import { tokenizeInline } from "./lexer.ts";

export { inlineKind } from "./kinds.ts";

export type InlineTokenStream = readonly number[];

// The generated lexer, resolver, semantic arena, and projector share this one
// region-local record layout. Markdown inline tokens never need discontiguous ranges.
export const inlineTokenStride = 4;
export { tokenizeInline };

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

export function firstInlineTokenEndingAfter(tokens: InlineTokenStream, offset: number): number {
  let low = 0;
  let high = inlineTokenCount(tokens);
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (inlineTokenEnd(tokens, middle) <= offset) {
      low = middle + 1;
    }
    else {
      high = middle;
    }
  }
  return low;
}

export function inlineTokenFlags(tokens: InlineTokenStream, index: number): number {
  return tokens[index * inlineTokenStride + 3];
}

export function setInlineTokenFlags(tokens: number[], index: number, flags: number): void {
  tokens[index * inlineTokenStride + 3] = flags;
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
