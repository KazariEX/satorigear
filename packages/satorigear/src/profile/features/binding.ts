import { Character } from "../../constants/character.ts";
import { InlineKind } from "../../constants/inline.ts";
import {
  appendInlineToken,
  inlineTokenData,
  inlineTokenEnd,
  inlineTokenStart,
} from "../../inline/tokens.ts";
import type { SyntaxFeature } from "../types.ts";
import type { Attributes } from "./attributes/types.ts";

export const feature: SyntaxFeature = {
  inline: {
    scan: [
      {
        marker: Character.LeftCurlyBracket,
        scan(source, start, tokens) {
          if (source.charCodeAt(start + 1) !== Character.LeftCurlyBracket) {
            return -1;
          }
          const close = source.indexOf("}}", start + 2);
          if (close < 0) {
            return -1;
          }
          const separator = source.indexOf("||", start + 2);
          const valueEnd = separator < 0 || separator > close ? close : separator;
          if (!source.slice(start + 2, valueEnd).trim()) {
            return -1;
          }
          const end = close + 2;
          appendInlineToken(
            tokens,
            InlineKind.Binding,
            start,
            end,
            valueEnd - start,
          );
          return end;
        },
      },
    ],
    build: [
      {
        kind: "leaf",
        token: InlineKind.Binding,
        build(tokenIndex, sourceSpan, context) {
          const source = context.view.text;
          const tokenStart = inlineTokenStart(context.tokens, tokenIndex);
          const start = tokenStart + 2;
          const end = inlineTokenEnd(context.tokens, tokenIndex) - 2;
          const separator = tokenStart + inlineTokenData(context.tokens, tokenIndex);
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
