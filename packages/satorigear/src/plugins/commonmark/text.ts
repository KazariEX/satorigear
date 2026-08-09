import { decodeHTMLStrict } from "entities";
import { inlineTokenText } from "../../inline/runtime.ts";
import { appendInline, type InlineLeafProjector, withSpan } from "../../mdast.ts";

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
    withSpan({ type: "text", value: semanticText(text) }, sourceSpan.start, sourceSpan.end),
    sourceSpan.start,
  );
  return true;
};
