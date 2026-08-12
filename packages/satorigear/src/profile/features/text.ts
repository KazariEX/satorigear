import { decodeHTMLStrict } from "entities";
import {
  appendInline,
  type InlineLeafBuilder,
} from "../../fragment/inline.ts";
import { InlineTokenFlag, inlineTokenFlags, inlineTokenText } from "../../inline/tokens.ts";
import type { SyntaxFeature } from "../types.ts";

const semanticCharacter = /\\([!"#$%&'()*+,./:;<=>?@[\\\]^_`{|}~-])|&(?:#x[\da-f]{1,6}|#\d{1,7}|[a-z][\da-z]{1,31});/gi;

export function semanticText(value: string): string {
  if (!value.includes("\\") && !value.includes("&")) {
    return value;
  }
  return value.replace(semanticCharacter, (match, escaped) => escaped ?? decodeHTMLStrict(match));
}

export const buildInlineText: InlineLeafBuilder = (tokenIndex, sourceSpan, accumulator) => {
  const { context } = accumulator;
  const text = inlineTokenText(context.view.text, context.tokens, tokenIndex);
  appendInline(
    accumulator,
    {
      type: "text",
      value: inlineTokenFlags(context.tokens, tokenIndex) & InlineTokenFlag.DecodeText
        ? semanticText(text)
        : text,
      position: sourceSpan,
    },
  );
  return true;
};

export const feature: SyntaxFeature = {
  inline: {
    syntax: [
      { kind: "leaf", token: "Text", build: buildInlineText },
      { kind: "leaf", token: "Escape", build: buildInlineText },
      { kind: "leaf", token: "Entity", build: buildInlineText },
    ],
  },
};
