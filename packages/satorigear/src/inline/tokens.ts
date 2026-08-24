export type InlineTokenStream = readonly number[];

// The lexer, resolver, and node builders share this region-local record layout.
// Markdown inline tokens never need discontiguous ranges.
export const inlineTokenStride = 4;

// The token kind owns the fourth slot's meaning; token copies preserve it as opaque data.
// Zero means that the token carries no additional fact.

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

export function inlineTokenData(tokens: InlineTokenStream, index: number): number {
  return tokens[index * inlineTokenStride + 3];
}

export function setInlineTokenData(tokens: number[], index: number, data: number): void {
  tokens[index * inlineTokenStride + 3] = data;
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
  data = 0,
): void {
  target.push(kind, start, end, data);
}

export function copyInlineToken(target: number[], tokens: InlineTokenStream, index: number): void {
  const offset = index * inlineTokenStride;
  target.push(
    tokens[offset],
    tokens[offset + 1],
    tokens[offset + 2],
    tokens[offset + 3],
  );
}
