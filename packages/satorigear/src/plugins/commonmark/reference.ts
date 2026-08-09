import { createLinkDefinitionStart } from "../../block/scanner.ts";
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
  inlineTokenStride,
  inlineTokenText,
} from "../../inline/runtime.ts";
import type { PairedTokenConfig } from "../../inline/resolver.ts";
import type { InlineResolutionContext, InlineTransform } from "../profile.ts";

export function normalizeReferenceLabel(label: string): string {
  return label.trim().replace(/[ \t\r\n]+/g, " ").toLowerCase().toUpperCase();
}

export const linkDefinitionStart = createLinkDefinitionStart(normalizeReferenceLabel);

function splitReferenceTail(source: string, tokens: InlineTokenStream, index: number): InlineTokenStream {
  const start = inlineTokenStart(tokens, index);
  const end = inlineTokenEnd(tokens, index);
  const flags = inlineTokenFlags(tokens, index);
  const result: number[] = [];
  appendInlineToken(result, inlineKind("ReferenceSeparatorClose"), start, start + 1, flags);
  appendInlineToken(result, inlineKind("BracketOpen"), start + 1, start + 2);
  if (end > start + 3) {
    appendInlineToken(result, inlineKind("Text"), start + 2, end - 1);
  }
  appendInlineToken(result, inlineKind("ShortcutReferenceTail"), end - 1, end);
  return result;
}

// Recover the one-token overlap between adjacent full-reference candidates before pairing.
export const reassociateReferenceTails: InlineTransform = (source, tokens, context) => {
  const referenceTail = inlineKind("ReferenceTail");
  const bracketOpen = inlineKind("BracketOpen");
  const shortcutTail = inlineKind("ShortcutReferenceTail");
  const imageOpen = inlineKind("ImageOpen");
  const count = inlineTokenCount(tokens);
  let result: number[] | undefined;
  for (let index = 0; index < count; index++) {
    const kind = inlineTokenKind(tokens, index);
    const label = kind === referenceTail ? inlineTokenText(source, tokens, index).slice(2, -1) : "";
    if (kind !== referenceTail || context.hasReference(normalizeReferenceLabel(label))) {
      if (result) {
        copyInlineToken(result, tokens, index);
      }
      continue;
    }
    const openerIndex = index + 1;
    if (
      openerIndex >= count ||
      inlineTokenKind(tokens, openerIndex) !== bracketOpen ||
      inlineTokenStart(tokens, openerIndex) !== inlineTokenEnd(tokens, index)
    ) {
      if (result) {
        copyInlineToken(result, tokens, index);
      }
      continue;
    }
    let closerIndex = index + 2;
    let nested = false;
    while (closerIndex < count && inlineTokenKind(tokens, closerIndex) !== shortcutTail) {
      const closerKind = inlineTokenKind(tokens, closerIndex);
      nested ||= closerKind === bracketOpen || closerKind === imageOpen;
      closerIndex++;
    }
    if (closerIndex === count || nested) {
      if (result) {
        copyInlineToken(result, tokens, index);
      }
      continue;
    }
    const nextLabel = source.slice(inlineTokenEnd(tokens, openerIndex), inlineTokenStart(tokens, closerIndex));
    if (!context.hasReference(normalizeReferenceLabel(nextLabel))) {
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
    const split = splitReferenceTail(source, tokens, index);
    result.push(...split.slice(0, -inlineTokenStride));
    const offset = inlineTokenEnd(tokens, index) - 1;
    appendInlineToken(
      result,
      referenceTail,
      offset,
      inlineTokenEnd(tokens, closerIndex),
      inlineTokenFlags(tokens, index),
    );
    index = closerIndex;
  }
  return result ?? tokens;
};

const activateReference: NonNullable<PairedTokenConfig<InlineResolutionContext>["activate"]> = ({
  source,
  tokens,
  closerIndex,
  content,
  state,
}) => {
  const closer = inlineTokenText(source, tokens, closerIndex);
  const explicit = closer.startsWith("][") ? closer.slice(2, -1) : "";
  return state.hasReference(normalizeReferenceLabel(explicit || content));
};

export const markdownBracketPairs: readonly PairedTokenConfig<InlineResolutionContext>[] = [
  {
    opener: "BracketOpen",
    closer: "LinkTail",
    open: "LinkOpen",
    close: "LinkClose",
    deactivateEarlier: ["BracketOpen"],
    isolateDelimiters: true,
  },
  {
    opener: "ImageOpen",
    closer: "LinkTail",
    open: "ImageLinkOpen",
    close: "ImageLinkClose",
  },
  {
    opener: "BracketOpen",
    closer: "ReferenceTail",
    open: "ReferenceOpen",
    close: "ReferenceClose",
    deactivateEarlier: ["BracketOpen"],
    isolateDelimiters: true,
    activate: activateReference,
    splitUnmatchedCloser: splitReferenceTail,
  },
  {
    opener: "BracketOpen",
    closer: "ShortcutReferenceTail",
    open: "ReferenceOpen",
    close: "ReferenceClose",
    deactivateEarlier: ["BracketOpen"],
    isolateDelimiters: true,
    activate: activateReference,
    content: {
      requireNonWhitespace: true,
      maxCharacters: 999,
      forbidTokens: ["BracketOpen", "ImageOpen"],
    },
  },
  {
    opener: "ImageOpen",
    closer: "ReferenceTail",
    open: "ImageReferenceOpen",
    close: "ImageReferenceClose",
    isolateDelimiters: true,
    activate: activateReference,
    splitUnmatchedCloser: splitReferenceTail,
  },
  {
    opener: "ImageOpen",
    closer: "ShortcutReferenceTail",
    open: "ImageReferenceOpen",
    close: "ImageReferenceClose",
    isolateDelimiters: true,
    activate: activateReference,
    content: {
      requireNonWhitespace: true,
      maxCharacters: 999,
      forbidTokens: ["BracketOpen", "ImageOpen"],
    },
  },
];
