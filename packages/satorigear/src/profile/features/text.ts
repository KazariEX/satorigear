import { Character } from "../../constants/character.ts";
import { InlineKind } from "../../constants/inline.ts";
import { matchInlinePatternEnd } from "../../inline/tokenize.ts";
import { appendInlineToken, inlineTokenText } from "../../inline/tokens.ts";
import { isAsciiPunctuation, semanticText } from "../utils.ts";
import type { InlineTextBuilder } from "../../fragment/inline.ts";
import type { SyntaxFeature } from "../types.ts";

const entity = /&(?:#x[0-9A-F]{1,6}|#\d{1,7}|[A-Z][A-Z0-9]{0,30});/iy;

export const buildLiteralInlineText: InlineTextBuilder = (tokenIndex, context) => {
  return inlineTokenText(context.view.text, context.tokens, tokenIndex);
};

export const buildEscapedInlineText: InlineTextBuilder = (tokenIndex, context) => {
  return inlineTokenText(context.view.text, context.tokens, tokenIndex, 1, 0);
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
            // The break absorbs its line ending, so projection spans one token.
            let offset = start + 2;
            if (next === Character.CarriageReturn && source.charCodeAt(offset) === Character.LineFeed) {
              offset++;
            }
            const lineStart = offset;
            while (source.charCodeAt(offset) === Character.Space) {
              offset++;
            }
            appendInlineToken(tokens, InlineKind.HardBreak, start, offset, lineStart);
            return offset;
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
      { kind: "text", token: InlineKind.LiteralText, build: buildLiteralInlineText },
      { kind: "text", token: InlineKind.Escape, build: buildEscapedInlineText },
      { kind: "text", token: InlineKind.Entity, build: buildDecodedInlineText },
    ],
  },
};
