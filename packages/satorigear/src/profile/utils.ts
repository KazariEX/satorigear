import { inlineKind } from "../inline/kinds.ts";
import {
  appendInlineToken,
  inlineTokenEnd,
  InlineTokenFlag,
  inlineTokenFlags,
  inlineTokenStart,
  type InlineTokenStream,
} from "../inline/tokens.ts";

const referenceSeparatorCloseKind = inlineKind("ReferenceSeparatorClose");
const bracketOpenKind = inlineKind("BracketOpen");
const textKind = inlineKind("Text");
const shortcutReferenceTailKind = inlineKind("ShortcutReferenceTail");

export function normalizeAssociationLabel(label: string): string {
  return label.trim().replace(/[ \t\r\n]+/g, " ").toLowerCase().toUpperCase();
}

export function splitReferenceTail(tokens: InlineTokenStream, index: number): InlineTokenStream {
  const start = inlineTokenStart(tokens, index);
  const end = inlineTokenEnd(tokens, index);
  const flags = inlineTokenFlags(tokens, index);
  const decodeFlags = flags & InlineTokenFlag.DecodeText;
  const result: number[] = [];
  appendInlineToken(result, referenceSeparatorCloseKind, start, start + 1, flags & ~InlineTokenFlag.DecodeText);
  appendInlineToken(result, bracketOpenKind, start + 1, start + 2);
  if (end > start + 3) {
    appendInlineToken(result, textKind, start + 2, end - 1, decodeFlags);
  }
  appendInlineToken(result, shortcutReferenceTailKind, end - 1, end);
  return result;
}
