import { InlineKind } from "../constants/inline.ts";
import {
  appendInlineToken,
  inlineTokenEnd,
  InlineTokenFlag,
  inlineTokenFlags,
  inlineTokenStart,
  type InlineTokenStream,
} from "../inline/tokens.ts";

export function normalizeAssociationLabel(label: string): string {
  return label.trim().replace(/[ \t\r\n]+/g, " ").toLowerCase().toUpperCase();
}

export function splitReferenceTail(tokens: InlineTokenStream, index: number): InlineTokenStream {
  const start = inlineTokenStart(tokens, index);
  const end = inlineTokenEnd(tokens, index);
  const flags = inlineTokenFlags(tokens, index);
  const decodeFlags = flags & InlineTokenFlag.DecodeText;
  const result: number[] = [];
  appendInlineToken(result, InlineKind.ReferenceSeparatorClose, start, start + 1, flags & ~InlineTokenFlag.DecodeText);
  appendInlineToken(result, InlineKind.BracketOpen, start + 1, start + 2);
  if (end > start + 3) {
    appendInlineToken(result, InlineKind.Text, start + 2, end - 1, decodeFlags);
  }
  appendInlineToken(result, InlineKind.BracketClose, end - 1, end);
  return result;
}
