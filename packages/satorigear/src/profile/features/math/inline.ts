import { Character } from "../../../constants/character.ts";
import { InlineKind } from "../../../constants/inline.ts";
import { findClosingRunEnd, findMarkerRunEnd, type InlineScanRule } from "../../../inline/tokenizer.ts";
import { appendInlineToken, inlineTokenData, inlineTokenText } from "../../../inline/tokens.ts";
import { hasInlinePadding } from "../../utils.ts";
import type { InlineBuildRule } from "../../../inline/profile.ts";

export function createMathScanRule(singleDollarTextMath: boolean): InlineScanRule {
  const minimum = singleDollarTextMath ? 1 : 2;
  return {
    marker: Character.DollarSign,
    scan(source, start, tokens) {
      // Math must claim its closer before ordinary tokens can span across that boundary.
      const openEnd = findMarkerRunEnd(source, start, Character.DollarSign);
      const markerLength = openEnd - start;
      const end = markerLength >= minimum
        ? findClosingRunEnd(source, openEnd, markerLength, "$", Character.DollarSign)
        : -1;
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
    build(tokenIndex, position, context) {
      const markerLength = inlineTokenData(context.tokens, tokenIndex);
      const text = inlineTokenText(context.view.text, context.tokens, tokenIndex, markerLength);
      return {
        type: "inlineMath",
        value: hasInlinePadding(text)
          ? text.slice(text.startsWith("\r\n") ? 2 : 1, text.endsWith("\r\n") ? -2 : -1)
          : text,
        position,
      };
    },
  },
];
