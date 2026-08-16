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
  inlineTokenText,
} from "../../../inline/tokens.ts";
import { normalizeAssociationLabel } from "../../utils.ts";
import { semanticText } from "../text.ts";
import { footnoteLabelAt } from "./shared.ts";
import type { InlineBuildRule, InlineTokenTransform } from "../../../inline/profile.ts";

function closerIndex(tokens: InlineTokenStream, start: number, end: number): number {
  for (let index = start + 1; index < inlineTokenCount(tokens); index++) {
    if (inlineTokenStart(tokens, index) >= end) {
      break;
    }
    const kind = inlineTokenKind(tokens, index);
    if (kind === InlineKind.BracketClose && inlineTokenEnd(tokens, index) === end) {
      return index;
    }
  }
  return -1;
}

export const transformFootnoteTokens: InlineTokenTransform = (source, tokens, context) => {
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
      index = close;
      continue;
    }
    if (result) {
      copyInlineToken(result, tokens, index);
    }
  }
  return result ?? tokens;
};

export const inlineBuilds: readonly InlineBuildRule[] = [
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
