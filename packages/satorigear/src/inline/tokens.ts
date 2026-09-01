export type InlineTokenStream = readonly number[];

// The lexer, resolver, and node builders share this region-local record layout.
// Markdown inline tokens never need discontiguous ranges.
const enum InlineTokenField {
  Kind,
  Start,
  End,
  Data,
  Stride,
}

// Newline spans its physical line ending and stripped indentation; Data stores the next line start.
// Token copies preserve this slot as opaque data.
// Zero means that the token carries no additional fact.

export function inlineTokenCount(tokens: InlineTokenStream): number {
  return tokens.length / InlineTokenField.Stride;
}

export function inlineTokenKind(tokens: InlineTokenStream, index: number): number {
  return tokens[index * InlineTokenField.Stride + InlineTokenField.Kind];
}

export function inlineTokenStart(tokens: InlineTokenStream, index: number): number {
  return tokens[index * InlineTokenField.Stride + InlineTokenField.Start];
}

export function inlineTokenEnd(tokens: InlineTokenStream, index: number): number {
  return tokens[index * InlineTokenField.Stride + InlineTokenField.End];
}

export function inlineTokenData(tokens: InlineTokenStream, index: number): number {
  return tokens[index * InlineTokenField.Stride + InlineTokenField.Data];
}

export function setInlineTokenData(tokens: number[], index: number, data: number): void {
  tokens[index * InlineTokenField.Stride + InlineTokenField.Data] = data;
}

export function rewriteInlineTokenTail(
  tokens: number[],
  kind: number,
  end: number,
): void {
  const offset = tokens.length - InlineTokenField.Stride;
  tokens[offset + InlineTokenField.Kind] = kind;
  tokens[offset + InlineTokenField.End] = end;
}

export function inlineTokenText(
  source: string,
  tokens: InlineTokenStream,
  index: number,
  startPadding = 0,
  endPadding = startPadding,
): string {
  return source.slice(
    inlineTokenStart(tokens, index) + startPadding,
    inlineTokenEnd(tokens, index) - endPadding,
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
  const offset = index * InlineTokenField.Stride;
  target.push(
    tokens[offset],
    tokens[offset + InlineTokenField.Start],
    tokens[offset + InlineTokenField.End],
    tokens[offset + InlineTokenField.Data],
  );
}
