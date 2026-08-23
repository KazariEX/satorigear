import { decodeHTMLStrict } from "entities";
import { Character } from "../../constants/character.ts";
import { InlineKind } from "../../constants/inline.ts";
import { matchInlinePatternEnd } from "../../inline/lexer.ts";
import {
  appendInlineToken,
  inlineTokenText,
} from "../../inline/tokens.ts";
import type { InlineLeafBuilder } from "../../fragment/inline.ts";
import type { SyntaxFeature } from "../types.ts";

const semanticCharacter = /\\([!"#$%&'()*+,./:;<=>?@[\\\]^_`{|}~-])|&(?:#x[\da-f]{1,6}|#\d{1,7}|[a-z][\da-z]{1,31});/gi;
const entity = /&(?:#x[0-9A-F]{1,6}|#\d{1,7}|[A-Z][A-Z0-9]{0,30});/iy;

function isAsciiPunctuation(code: number): boolean {
  return (
    code >= Character.ExclamationMark && code <= Character.Solidus ||
    code >= Character.Colon && code <= Character.CommercialAt ||
    code >= Character.LeftSquareBracket && code <= Character.GraveAccent ||
    code >= Character.LeftCurlyBracket && code <= Character.Tilde
  );
}

export function semanticText(value: string): string {
  if (!value.includes("\\") && !value.includes("&")) {
    return value;
  }
  return value.replace(semanticCharacter, (match, escaped) => escaped ?? decodeHTMLStrict(match));
}

export const buildInlineText: InlineLeafBuilder = (tokenIndex, sourceSpan, context) => {
  const text = inlineTokenText(context.view.text, context.tokens, tokenIndex);
  return {
    type: "text",
    value: text,
    position: sourceSpan,
  };
};

export const buildDecodedInlineText: InlineLeafBuilder = (tokenIndex, sourceSpan, context) => {
  const text = inlineTokenText(context.view.text, context.tokens, tokenIndex);
  return {
    type: "text",
    value: semanticText(text),
    position: sourceSpan,
  };
};

export const feature: SyntaxFeature = {
  inline: {
    scan: [
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
    build: [
      { kind: "leaf", token: InlineKind.LiteralText, build: buildInlineText },
      { kind: "leaf", token: InlineKind.Escape, build: buildDecodedInlineText },
      { kind: "leaf", token: InlineKind.Entity, build: buildDecodedInlineText },
    ],
  },
};
