import { appendInline } from "../../../fragment/inline.ts";
import { inlineKind } from "../../../inline/kinds.ts";
import {
  appendInlineToken,
  firstInlineTokenEndingAfter,
  inlineTokenCount,
  inlineTokenEnd,
  inlineTokenFlags,
  inlineTokenKind,
  inlineTokenStart,
  type InlineTokenStream,
  inlineTokenText,
} from "../../../inline/tokens.ts";
import type { InlineSyntaxDefinition, InlineTokenTransform } from "../../../inline/profile.ts";

interface MathRange {
  end: number;
  flags: number;
  start: number;
}

const mathTextKind = inlineKind("MathText");
const textKind = inlineKind("Text");

function textTokenAt(tokens: InlineTokenStream, offset: number): number | undefined {
  const index = firstInlineTokenEndingAfter(tokens, offset);
  if (
    index < inlineTokenCount(tokens) &&
    inlineTokenStart(tokens, index) <= offset &&
    inlineTokenKind(tokens, index) === textKind
  ) {
    return index;
  }
}

function markerRunEnd(source: string, start: number): number {
  let end = start;
  while (source[end] === "$") {
    end++;
  }
  return end;
}

function firstMathRange(
  source: string,
  tokens: InlineTokenStream,
  minimum: number,
): MathRange | undefined {
  let search = 0;
  while (search < source.length) {
    const start = source.indexOf("$", search);
    if (start < 0) {
      break;
    }
    const tokenIndex = textTokenAt(tokens, start);
    if (
      tokenIndex === void 0 || (
        source[start - 1] === "$" && textTokenAt(tokens, start - 1) !== void 0
      )
    ) {
      search = start + 1;
      continue;
    }
    const openerEnd = markerRunEnd(source, start);
    const markerLength = openerEnd - start;
    search = openerEnd;
    if (markerLength < minimum) {
      continue;
    }
    let close = openerEnd;
    while (close < source.length) {
      close = source.indexOf("$", close);
      if (close < 0) {
        break;
      }
      const closeEnd = markerRunEnd(source, close);
      if (closeEnd - close === markerLength) {
        return {
          start,
          end: closeEnd,
          flags: inlineTokenFlags(tokens, tokenIndex),
        };
      }
      close = closeEnd;
    }
  }
}

function copyRange(
  target: number[],
  tokens: InlineTokenStream,
  start: number,
  end: number,
  offset: number,
): void {
  for (let index = firstInlineTokenEndingAfter(tokens, start); index < inlineTokenCount(tokens); index++) {
    const tokenStart = inlineTokenStart(tokens, index);
    if (tokenStart >= end) {
      break;
    }
    const tokenEnd = inlineTokenEnd(tokens, index);
    const fragmentStart = Math.max(start, tokenStart);
    const fragmentEnd = Math.min(end, tokenEnd);
    appendInlineToken(
      target,
      inlineTokenKind(tokens, index),
      fragmentStart + offset,
      fragmentEnd + offset,
      fragmentStart === tokenStart ? inlineTokenFlags(tokens, index) : 0,
    );
  }
}

export function createMathTokensTransform(singleDollarTextMath: boolean): InlineTokenTransform {
  return (source, tokens, context) => {
    const minimum = singleDollarTextMath ? 1 : 2;
    let segmentSource = source;
    let segmentStart = 0;
    let segmentTokens = tokens;
    let result: number[] | undefined;
    while (true) {
      const range = firstMathRange(segmentSource, segmentTokens, minimum);
      if (!range) {
        if (!result) {
          return tokens;
        }
        copyRange(result, segmentTokens, 0, segmentSource.length, segmentStart);
        return result;
      }

      result ??= [];
      copyRange(result, segmentTokens, 0, range.start, segmentStart);
      appendInlineToken(
        result,
        mathTextKind,
        segmentStart + range.start,
        segmentStart + range.end,
        range.flags,
      );
      segmentStart += range.end;
      if (segmentStart === source.length) {
        return result;
      }
      // The closer can cut through a token formed before math claimed its contents.
      segmentSource = source.slice(segmentStart);
      segmentTokens = context.tokenize(segmentSource);
    }
  };
}

function mathTextValue(value: string): string {
  let markerLength = 0;
  while (value[markerLength] === "$") {
    markerLength++;
  }
  if (markerLength === 0) {
    throw new Error("MathText token does not start with a dollar run");
  }
  let result = value.slice(markerLength, -markerLength);
  const startPadding = result.startsWith("\r\n") ? 2 : /^[ \r\n]/.test(result) ? 1 : 0;
  const endPadding = result.endsWith("\r\n") ? 2 : /[ \r\n]$/.test(result) ? 1 : 0;
  if (startPadding > 0 && endPadding > 0 && /[^ \r\n]/.test(result)) {
    result = result.slice(startPadding, -endPadding);
  }
  return result;
}

export const inlineSyntax: readonly InlineSyntaxDefinition[] = [
  {
    kind: "leaf",
    token: "MathText",
    build(tokenIndex, sourceSpan, accumulator) {
      const { context } = accumulator;
      appendInline(
        accumulator,
        {
          type: "inlineMath",
          value: mathTextValue(inlineTokenText(context.view.text, context.tokens, tokenIndex)),
          position: sourceSpan,
        },
      );
      return true;
    },
  },
];
