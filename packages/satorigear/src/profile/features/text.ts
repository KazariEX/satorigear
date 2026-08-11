import { decodeHTMLStrict } from "entities";
import type { Text } from "mdast";
import { inlineTokenText } from "../../inline/tokens.ts";
import {
  appendInline,
  type InlineLeafProjector,
  projectInlineChildren,
  withSpan,
} from "../../mdast.ts";
import type { SyntaxFeature } from "../types.ts";

const semanticCharacter = /\\([!"#$%&'()*+,./:;<=>?@[\\\]^_`{|}~-])|&(?:#x[\da-f]{1,6}|#\d{1,7}|[a-z][\da-z]{1,31});/gi;

export function semanticText(value: string): string {
  if (!value.includes("\\") && !value.includes("&")) {
    return value;
  }
  return value.replace(semanticCharacter, (match, escaped) => escaped ?? decodeHTMLStrict(match));
}

export const projectInlineText: InlineLeafProjector = (tokenIndex, sourceSpan, accumulator) => {
  const { context } = accumulator;
  const text = inlineTokenText(context.view.text, context.tokens, tokenIndex);
  appendInline(
    accumulator,
    withSpan<Text>({ type: "text", value: semanticText(text) }, sourceSpan.start, sourceSpan.end),
  );
  return true;
};

export const feature: SyntaxFeature = {
  inline: {
    rules: [
      { rule: "InlineLines", project: projectInlineChildren },
      { rule: "InlineLine", project: projectInlineChildren },
      { rule: "Inline", project: projectInlineChildren },
    ],
    tokens: [
      { token: "Text", project: projectInlineText },
      { token: "Escape", project: projectInlineText },
      { token: "Entity", project: projectInlineText },
    ],
  },
};
