import { decodeHTMLStrict } from "entities";
import { InlineKind } from "../../inline/kinds.ts";
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
    code >= 33 && code <= 47 ||
    code >= 58 && code <= 64 ||
    code >= 91 && code <= 96 ||
    code >= 123 && code <= 126
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
    lexical: [
      {
        marker: "&",
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
        marker: "\\",
        scan(source, start, tokens) {
          const next = source.charCodeAt(start + 1);
          let end = start + 1;
          let flags = 0;
          let kind = InlineKind.Delimiter;
          if (next === 10 || next === 13) {
            kind = InlineKind.HardBreak;
          }
          else if (isAsciiPunctuation(next)) {
            end++;
            flags = InlineTokenFlag.DecodeText;
            kind = InlineKind.Escape;
          }
          else if (next === 32 || next === 9) {
            end++;
            kind = InlineKind.Text;
          }
          appendInlineToken(tokens, kind, start, end, flags);
          return end;
        },
      },
    ],
    syntax: [
      { kind: "leaf", token: InlineKind.Text, build: buildInlineText },
      { kind: "leaf", token: InlineKind.Escape, build: buildInlineText },
      { kind: "leaf", token: InlineKind.Entity, build: buildInlineText },
    ],
  },
};
