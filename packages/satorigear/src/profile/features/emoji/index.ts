import { Character } from "../../../constants/character.ts";
import { InlineKind } from "../../../constants/inline.ts";
import { appendInlineToken, inlineTokenText } from "../../../inline/tokens.ts";
import { canStartInlineColon } from "../component/inline.ts";
import type { SyntaxFeature } from "../../types.ts";

function isShortcodeCharacter(code: number): boolean {
  // Permits ASCII letters, digits, `_`, `+`, and `-` anywhere in the name.
  return (
    code >= Character.LatinCapitalLetterA && code <= Character.LatinCapitalLetterZ ||
    code >= Character.LatinSmallLetterA && code <= Character.LatinSmallLetterZ ||
    code >= Character.DigitZero && code <= Character.DigitNine ||
    code === Character.PlusSign ||
    code === Character.HyphenMinus ||
    code === Character.LowLine
  );
}

export const feature: SyntaxFeature = {
  inline: {
    scans: [
      {
        marker: Character.Colon,
        scan(source, start, tokens) {
          if (!canStartInlineColon(source, start)) {
            return -1;
          }
          let end = start + 1;
          while (isShortcodeCharacter(source.charCodeAt(end))) {
            end++;
          }
          if (end === start + 1 || source.charCodeAt(end) !== Character.Colon) {
            return -1;
          }
          end++;
          appendInlineToken(tokens, InlineKind.Emoji, start, end);
          return end;
        },
      },
    ],
    builds: [
      {
        kind: "leaf",
        token: InlineKind.Emoji,
        build(tokenIndex, sourceSpan, context) {
          return {
            type: "emoji",
            value: inlineTokenText(context.view.text, context.tokens, tokenIndex),
            position: sourceSpan,
          };
        },
      },
    ],
  },
};
