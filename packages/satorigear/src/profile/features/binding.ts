import { Character } from "../../constants/character.ts";
import { InlineKind } from "../../inline/kinds.ts";
import {
  appendInlineToken,
  inlineTokenEnd,
  inlineTokenStart,
} from "../../inline/tokens.ts";
import type { SyntaxFeature } from "../types.ts";
import type { Attributes } from "./attributes/types.ts";

function bindingEnd(source: string, start: number): number {
  if (source.charCodeAt(start + 1) !== Character.LeftCurlyBracket) {
    return -1;
  }
  const close = source.indexOf("}}", start + 2);
  if (close < 0) {
    return -1;
  }
  const separator = source.indexOf("||", start + 2);
  const valueEnd = separator < 0 || separator > close ? close : separator;
  return source.slice(start + 2, valueEnd).trim() ? close + 2 : -1;
}

export const feature: SyntaxFeature = {
  inline: {
    lexical: [
      {
        marker: "{",
        scan(source, start, tokens) {
          const matchEnd = bindingEnd(source, start);
          const end = matchEnd < 0 ? start + 1 : matchEnd;
          appendInlineToken(
            tokens,
            matchEnd < 0 ? InlineKind.Text : InlineKind.Binding,
            start,
            end,
          );
          return end;
        },
      },
    ],
    syntax: [
      {
        kind: "leaf",
        token: InlineKind.Binding,
        build(tokenIndex, sourceSpan, context) {
          const source = context.view.text;
          const start = inlineTokenStart(context.tokens, tokenIndex) + 2;
          const end = inlineTokenEnd(context.tokens, tokenIndex) - 2;
          const match = source.indexOf("||", start);
          const separator = match < 0 || match > end ? end : match;
          const value = source.slice(start, separator).trim();
          const defaultValue = separator === end ? "" : source.slice(separator + 2, end).trim();
          const attributes: Attributes = { ":value": value };
          if (defaultValue) {
            attributes.defaultValue = defaultValue;
          }
          return {
            type: "inlineComponent",
            name: "binding",
            attributes,
            children: [],
            position: sourceSpan,
          };
        },
      },
    ],
  },
};
