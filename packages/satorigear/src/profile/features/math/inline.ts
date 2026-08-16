import { Character } from "../../../constants/character.ts";
import { InlineKind } from "../../../constants/inline.ts";
import { type InlineLexicalRule, inlineMarkerRunEnd } from "../../../inline/lexer.ts";
import { appendInlineToken, inlineTokenText } from "../../../inline/tokens.ts";
import type { InlineSyntaxDefinition } from "../../../inline/profile.ts";

export function createMathLexicalRule(singleDollarTextMath: boolean): InlineLexicalRule {
  const minimum = singleDollarTextMath ? 1 : 2;
  return {
    marker: Character.DollarSign,
    scan(source, start, tokens) {
      // Math must claim its closer before ordinary tokens can span across that boundary.
      const openEnd = inlineMarkerRunEnd(source, start);
      const markerLength = openEnd - start;
      let end = -1;
      if (markerLength >= minimum) {
        let close = openEnd;
        while (close < source.length) {
          close = source.indexOf("$", close);
          if (close < 0) {
            break;
          }
          const closeEnd = inlineMarkerRunEnd(source, close);
          if (closeEnd - close === markerLength) {
            end = closeEnd;
            break;
          }
          close = closeEnd;
        }
      }
      if (end < 0) {
        end = openEnd;
      }
      appendInlineToken(
        tokens,
        end === openEnd ? InlineKind.Text : InlineKind.MathText,
        start,
        end,
      );
      return end;
    },
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
    token: InlineKind.MathText,
    build(tokenIndex, sourceSpan, context) {
      return {
        type: "inlineMath",
        value: mathTextValue(inlineTokenText(context.view.text, context.tokens, tokenIndex)),
        position: sourceSpan,
      };
    },
  },
];
