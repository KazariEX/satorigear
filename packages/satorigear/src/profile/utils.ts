import {
  appendInlineToken,
  inlineKind,
  inlineTokenEnd,
  inlineTokenFlags,
  inlineTokenStart,
  type InlineTokenStream,
} from "../inline/runtime.ts";

export function normalizeAssociationLabel(label: string): string {
  return label.trim().replace(/[ \t\r\n]+/g, " ").toLowerCase().toUpperCase();
}

export function splitReferenceTail(tokens: InlineTokenStream, index: number): InlineTokenStream {
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
