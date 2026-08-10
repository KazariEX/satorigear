import * as generatedInline from "../generated/inline.ts";
import type { TextEdit } from "../source-view.ts";
import type { SyntaxArena } from "../syntax-protocol.ts";
import type { InlineTokenChange, InlineTokenStream } from "./tokens.ts";

export interface InlineSyntaxDocument {
  readonly arena: SyntaxArena;
  readonly rootId: number;

  edit: (edits: readonly TextEdit[], change: InlineTokenChange) => void;
}

interface InlineForestSegment {
  source: string;
  tokens: InlineTokenStream;
}

export const inlineSyntaxArena: SyntaxArena = generatedInline.tree;
const inlineBoundaryKind = generatedInline.tokenKind("InlineBoundary");

export function parseInline(source: string, tokens: InlineTokenStream): number {
  return generatedInline.parsePackedTokens(source, tokens, "InlineLines");
}

export function parseInlineForest(segments: readonly InlineForestSegment[]): number {
  return generatedInline.parsePackedTokenSegments(segments, inlineBoundaryKind, "InlineForest");
}

export function createInlineSyntaxDocument(
  source: string,
  tokens: InlineTokenStream,
): InlineSyntaxDocument {
  const parser = generatedInline.createParser();
  const handle = parser.parsePackedTokens(source, tokens, "InlineLines");
  return {
    arena: parser.tree,
    get rootId() {
      return handle.root;
    },
    edit: (edits, change) => parser.editPackedTokens(handle, edits, change),
  };
}
