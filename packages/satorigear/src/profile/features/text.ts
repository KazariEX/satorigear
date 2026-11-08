import { Character } from "../../constants/character.ts";
import { InlineKind } from "../../constants/inline.ts";
import { matchInlinePatternEnd } from "../../inline/tokenize.ts";
import { appendInlineToken, inlineTokenText } from "../../inline/tokens.ts";
import { isAsciiPunctuation, semanticText } from "../utils.ts";
import type { InlineTextBuilder } from "../../fragment/inline.ts";
import type { SyntaxFeature } from "../types.ts";

const entity = /&(?:#x[0-9A-F]{1,6}|#\d{1,7}|[A-Z][A-Z0-9]{0,30});/iy;

export const buildInlineText: InlineTextBuilder = (tokenIndex, context) => {
  return inlineTokenText(context.view.text, context.tokens, tokenIndex);
};

export const buildDecodedInlineText: InlineTextBuilder = (tokenIndex, context) => {
  const text = inlineTokenText(context.view.text, context.tokens, tokenIndex);
  return semanticText(text);
};

export const feature: SyntaxFeature = {
  inline: {
    scans: [
      {
        marker: Character.Ampersand,
        scan(source, start, tokens) {
          const matchEnd = matchInlinePatternEnd(entity, source, start);
          if (matchEnd < 0) {
            return start + 1;
          }
          appendInlineToken(tokens, InlineKind.Entity, start, matchEnd);
          return matchEnd;
        },
      },
      {
        marker: Character.ReverseSolidus,
        scan(source, start, tokens) {
          const next = source.charCodeAt(start + 1);
          if (next === Character.LineFeed || next === Character.CarriageReturn) {
            appendInlineToken(tokens, InlineKind.HardBreak, start, start + 1);
            return start + 1;
          }
          if (isAsciiPunctuation(next)) {
            const end = start + 2;
            appendInlineToken(tokens, InlineKind.Escape, start, end);
            return end;
          }
          return start + (
            next === Character.Space || next === Character.CharacterTabulation
              ? 2
              : 1
          );
        },
      },
    ],
    builds: [
      { kind: "text", token: InlineKind.LiteralText, build: buildInlineText },
      { kind: "text", token: InlineKind.Escape, build: buildDecodedInlineText },
      { kind: "text", token: InlineKind.Entity, build: buildDecodedInlineText },
    ],
  },
};
