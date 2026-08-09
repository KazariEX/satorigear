import * as generatedBlocks from "../generated/blocks.ts";
import type { SyntaxArena, SyntaxArenaView } from "../syntax-protocol.ts";
import type { TextEdit } from "../text-edit.ts";
import type { BlockToken, BlockTokenChange } from "./tokens.ts";

export type BlockSyntaxView = SyntaxArenaView<BlockToken>;

export interface BlockSyntaxDocument {
  readonly rootId: number;

  edit: (
    edits: readonly TextEdit[],
    change: BlockTokenChange,
  ) => void;
  view: (tokens: readonly BlockToken[]) => BlockSyntaxView;
}

export interface BlockSyntaxParser {
  // Stateless parses expose their module arena directly because callers consume it before the next parse.
  readonly arena: SyntaxArena;

  createDocument: (source: string, tokens: readonly BlockToken[], entryRule?: string) => BlockSyntaxDocument;
  parseTokens: (source: string, tokens: readonly BlockToken[], entryRule?: string) => number;
}

export const blockSyntaxParser: BlockSyntaxParser = {
  arena: generatedBlocks.tree,
  createDocument(source, tokens, entryRule) {
    const parser = generatedBlocks.createParser();
    const handle = parser.parseTokens(source, tokens, entryRule);
    return {
      get rootId() {
        return handle.root;
      },
      edit: (edits, change) => parser.editTokens(handle, edits, change),
      view(currentTokens) {
        return {
          arena: parser.tree,
          root: {
            id: handle.root,
            offset: currentTokens[0]
              ? currentTokens[0].ranges?.[0]?.offset ?? currentTokens[0].offset
              : 0,
            tokenBase: 0,
          },
          tokenAt(index: number) {
            const token = currentTokens[index];
            if (!token) {
              throw new Error("emitted parser returned a leaf outside its token stream");
            }
            return token;
          },
        };
      },
    };
  },
  parseTokens: generatedBlocks.parseTokens,
};
