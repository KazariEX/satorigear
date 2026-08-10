import type { FootnoteReference } from "mdast";
import {
  appendInlineToken,
  copyInlineToken,
  inlineKind,
  inlineTokenCount,
  inlineTokenEnd,
  inlineTokenFlags,
  inlineTokenKind,
  inlineTokenStart,
  type InlineTokenStream,
  inlineTokenText,
} from "../../../inline/runtime.ts";
import { appendInline, withSpan } from "../../../mdast.ts";
import { normalizeAssociationLabel, splitReferenceTail } from "../../utils.ts";
import { semanticText } from "../text.ts";
import { footnoteLabelAt } from "./shared.ts";
import type {
  InlineResolutionContext,
  InlineTransform,
  SyntaxFeature,
} from "../../types.ts";

const bracketOpenKind = inlineKind("BracketOpen");
const footnoteReferenceKind = inlineKind("FootnoteReference");
const imageOpenKind = inlineKind("ImageOpen");
const referenceSeparatorCloseKind = inlineKind("ReferenceSeparatorClose");
const referenceTailKind = inlineKind("ReferenceTail");
const shortcutReferenceTailKind = inlineKind("ShortcutReferenceTail");
const textKind = inlineKind("Text");

function closerIndex(tokens: InlineTokenStream, start: number, end: number): number {
  for (let index = start + 1; index < inlineTokenCount(tokens); index++) {
    if (inlineTokenStart(tokens, index) >= end) {
      break;
    }
    if (
      inlineTokenEnd(tokens, index) === end && (
        inlineTokenKind(tokens, index) === shortcutReferenceTailKind ||
        inlineTokenKind(tokens, index) === referenceSeparatorCloseKind
      )
    ) {
      return index;
    }
  }
  return -1;
}

function splitFootnoteTails(
  source: string,
  tokens: InlineTokenStream,
  context: InlineResolutionContext,
): InlineTokenStream {
  // A ReferenceTail owns both the previous `]` and the next label; active footnotes need that boundary back.
  let activeFootnoteEnd = -1;
  let result: number[] | undefined;
  for (let index = 0; index < inlineTokenCount(tokens); index++) {
    const kind = inlineTokenKind(tokens, index);
    const start = inlineTokenStart(tokens, index);
    if (start >= activeFootnoteEnd) {
      activeFootnoteEnd = -1;
    }
    if (kind === bracketOpenKind || kind === imageOpenKind) {
      const label = footnoteLabelAt(
        source,
        kind === imageOpenKind ? start + 1 : start,
        source.length,
      );
      activeFootnoteEnd = label && context.hasDefinition(label.definitionKey)
        ? label.end
        : -1;
    }
    if (kind !== referenceTailKind) {
      if (result) {
        copyInlineToken(result, tokens, index);
      }
      continue;
    }
    const embedded = footnoteLabelAt(source, start + 1, inlineTokenEnd(tokens, index));
    if (
      activeFootnoteEnd !== start + 1 && (
        !embedded ||
        !context.hasDefinition(embedded.definitionKey)
      )
    ) {
      if (result) {
        copyInlineToken(result, tokens, index);
      }
      continue;
    }
    if (!result) {
      result = [];
      for (let prefix = 0; prefix < index; prefix++) {
        copyInlineToken(result, tokens, prefix);
      }
    }
    result.push(...splitReferenceTail(tokens, index));
    activeFootnoteEnd = -1;
  }
  return result ?? tokens;
}

const activateFootnoteReferences: InlineTransform = (source, tokens, context) => {
  let result: number[] | undefined;
  for (let index = 0; index < inlineTokenCount(tokens); index++) {
    const start = inlineTokenStart(tokens, index);
    const kind = inlineTokenKind(tokens, index);
    const labelStart = kind === imageOpenKind ? start + 1 : start;
    const label = kind === bracketOpenKind || kind === imageOpenKind
      ? footnoteLabelAt(source, labelStart, source.length)
      : void 0;
    const close = label ? closerIndex(tokens, index, label.end) : -1;
    if (
      !label ||
      close < 0 ||
      !context.hasDefinition(label.definitionKey)
    ) {
      if (result) {
        copyInlineToken(result, tokens, index);
      }
      continue;
    }
    if (!result) {
      result = [];
      for (let prefix = 0; prefix < index; prefix++) {
        copyInlineToken(result, tokens, prefix);
      }
    }
    if (kind === imageOpenKind) {
      appendInlineToken(result, textKind, start, labelStart, inlineTokenFlags(tokens, index));
    }
    appendInlineToken(
      result,
      footnoteReferenceKind,
      labelStart,
      label.end,
      inlineTokenFlags(tokens, index),
    );
    index = close;
  }
  return result ?? tokens;
};

export const transformInlineFootnotes: InlineTransform = (source, tokens, context) => activateFootnoteReferences(
  source,
  splitFootnoteTails(source, tokens, context),
  context,
);

export const inlineTokens: SyntaxFeature["inlineTokens"] = [
  {
    token: "FootnoteReference",
    project(tokenIndex, sourceSpan, accumulator) {
      const { context } = accumulator;
      const source = inlineTokenText(context.view.text, context.tokens, tokenIndex);
      const label = source.slice(2, -1);
      appendInline(accumulator, withSpan<FootnoteReference>({
        type: "footnoteReference",
        identifier: normalizeAssociationLabel(label).toLowerCase(),
        label: semanticText(label),
      }, sourceSpan.start, sourceSpan.end), sourceSpan.start);
      return true;
    },
  },
];
