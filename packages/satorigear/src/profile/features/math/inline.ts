import { Character } from "../../../constants/character.ts";
import { InlineKind } from "../../../constants/inline.ts";
import { inlineMarkerRunEnd, type InlineScanRule } from "../../../inline/lexer.ts";
import {
  appendInlineToken,
  inlineTokenData,
  inlineTokenText,
} from "../../../inline/tokens.ts";
import type { InlineBuildRule } from "../../../inline/profile.ts";

export function createMathScanRule(singleDollarTextMath: boolean): InlineScanRule {
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
        return openEnd;
      }
      appendInlineToken(tokens, InlineKind.MathText, start, end, markerLength);
      return end;
    },
  };
}

export const inlineBuilds: readonly InlineBuildRule[] = [
  {
    kind: "leaf",
    token: InlineKind.MathText,
    build(tokenIndex, sourceSpan, context) {
      const markerLength = inlineTokenData(context.tokens, tokenIndex);
      let value = inlineTokenText(context.view.text, context.tokens, tokenIndex).slice(markerLength, -markerLength);
      const startPadding = value.startsWith("\r\n") ? 2 : /^[ \r\n]/.test(value) ? 1 : 0;
      const endPadding = value.endsWith("\r\n") ? 2 : /[ \r\n]$/.test(value) ? 1 : 0;
      if (startPadding > 0 && endPadding > 0 && /[^ \r\n]/.test(value)) {
        value = value.slice(startPadding, -endPadding);
      }
      return {
        type: "inlineMath",
        value,
        position: sourceSpan,
      };
    },
  },
];
