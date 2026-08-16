import { InlineKind } from "../../../constants/inline.ts";
import {
  appendInlineToken,
  copyInlineToken,
  inlineTokenCount,
  inlineTokenEnd,
  inlineTokenFlags,
  inlineTokenKind,
  inlineTokenStart,
  type InlineTokenStream,
  inlineTokenStride,
  inlineTokenText,
} from "../../../inline/tokens.ts";
import { normalizeAssociationLabel, splitReferenceTail } from "../../utils.ts";
import { semanticText } from "../text.ts";
import { footnoteLabelAt } from "./shared.ts";
import type { InlineSyntaxDefinition, InlineTokenRewrite } from "../../../inline/profile.ts";

function closerIndex(tokens: InlineTokenStream, start: number, end: number): number {
  for (let index = start + 1; index < inlineTokenCount(tokens); index++) {
    if (inlineTokenStart(tokens, index) >= end) {
      break;
    }
    const kind = inlineTokenKind(tokens, index);
    if (
      inlineTokenEnd(tokens, index) === end && (
        kind === InlineKind.BracketClose ||
        kind === InlineKind.ReferenceSeparatorClose
      ) ||
      kind === InlineKind.ReferenceTail && inlineTokenStart(tokens, index) + 1 === end
    ) {
      return index;
    }
  }
  return -1;
}

export const rewriteFootnoteTokens: InlineTokenRewrite = (source, tokens, context) => {
  let result: number[] | undefined;
  for (let index = 0; index < inlineTokenCount(tokens); index++) {
    const start = inlineTokenStart(tokens, index);
    const kind = inlineTokenKind(tokens, index);
    const labelStart = kind === InlineKind.ImageOpen ? start + 1 : start;
    const label = kind === InlineKind.BracketOpen || kind === InlineKind.ImageOpen
      ? footnoteLabelAt(source, labelStart, source.length)
      : void 0;
    const close = label ? closerIndex(tokens, index, label.end) : -1;
    if (label && close >= 0 && context.hasDefinition(label.definitionKey)) {
      if (!result) {
        result = [];
        for (let prefix = 0; prefix < index; prefix++) {
          copyInlineToken(result, tokens, prefix);
        }
      }
      if (kind === InlineKind.ImageOpen) {
        appendInlineToken(result, InlineKind.Text, start, labelStart, inlineTokenFlags(tokens, index));
      }
      appendInlineToken(
        result,
        InlineKind.FootnoteReference,
        labelStart,
        label.end,
        inlineTokenFlags(tokens, index),
      );
      if (inlineTokenKind(tokens, close) === InlineKind.ReferenceTail) {
        const embedded = footnoteLabelAt(source, label.end, inlineTokenEnd(tokens, close));
        if (embedded && context.hasDefinition(embedded.definitionKey)) {
          appendInlineToken(result, InlineKind.FootnoteReference, label.end, embedded.end);
        }
        else {
          result.push(...splitReferenceTail(tokens, close).slice(inlineTokenStride));
        }
      }
      index = close;
      continue;
    }

    if (kind === InlineKind.ReferenceTail) {
      const embedded = footnoteLabelAt(source, start + 1, inlineTokenEnd(tokens, index));
      if (embedded && context.hasDefinition(embedded.definitionKey)) {
        if (!result) {
          result = [];
          for (let prefix = 0; prefix < index; prefix++) {
            copyInlineToken(result, tokens, prefix);
          }
        }
        result.push(...splitReferenceTail(tokens, index).slice(0, inlineTokenStride));
        appendInlineToken(result, InlineKind.FootnoteReference, start + 1, embedded.end);
        continue;
      }
    }
    if (result) {
      copyInlineToken(result, tokens, index);
    }
  }
  return result ?? tokens;
};

export const inlineSyntax: readonly InlineSyntaxDefinition[] = [
  {
    kind: "leaf",
    token: InlineKind.FootnoteReference,
    build(tokenIndex, sourceSpan, context) {
      const source = inlineTokenText(context.view.text, context.tokens, tokenIndex);
      const label = source.slice(2, -1);
      return {
        type: "footnoteReference",
        identifier: normalizeAssociationLabel(label).toLowerCase(),
        label: semanticText(label),
        position: sourceSpan,
      };
    },
  },
];
