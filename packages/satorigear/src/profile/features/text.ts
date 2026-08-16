import { decodeHTMLStrict } from "entities";
import { Character } from "../../constants/character.ts";
import { InlineKind } from "../../constants/inline.ts";
import { matchInlinePatternEnd } from "../../inline/lexer.ts";
import {
  appendInlineToken,
  InlineTokenFlag,
  inlineTokenFlags,
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
    value: inlineTokenFlags(context.tokens, tokenIndex) & InlineTokenFlag.DecodeText
      ? semanticText(text)
      : text,
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
          const end = matchEnd < 0 ? start + 1 : matchEnd;
          appendInlineToken(
            tokens,
            matchEnd < 0 ? InlineKind.Delimiter : InlineKind.Entity,
            start,
            end,
            matchEnd < 0 ? 0 : InlineTokenFlag.DecodeText,
          );
          return end;
        },
      },
      {
        marker: Character.ReverseSolidus,
        scan(source, start, tokens) {
          const next = source.charCodeAt(start + 1);
          let end = start + 1;
          let flags = 0;
          let kind = InlineKind.Delimiter;
          if (next === Character.LineFeed || next === Character.CarriageReturn) {
            kind = InlineKind.HardBreak;
          }
          else if (isAsciiPunctuation(next)) {
            end++;
            flags = InlineTokenFlag.DecodeText;
            kind = InlineKind.Escape;
          }
          else if (next === Character.Space || next === Character.CharacterTabulation) {
            end++;
            kind = InlineKind.Text;
          }
          appendInlineToken(tokens, kind, start, end, flags);
          return end;
        },
      },
    ],
    build: [
      { kind: "leaf", token: InlineKind.Text, build: buildInlineText },
      { kind: "leaf", token: InlineKind.Delimiter, build: buildInlineText },
      { kind: "leaf", token: InlineKind.Escape, build: buildInlineText },
      { kind: "leaf", token: InlineKind.Entity, build: buildInlineText },
    ],
  },
};
