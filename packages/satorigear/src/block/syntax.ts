import * as generatedBlocks from "../generated/blocks.ts";
import type { TextEdit } from "../source-view.ts";
import type { SyntaxArenaView } from "../syntax-protocol.ts";
import type { BlockToken, BlockTokenChange } from "./tokens.ts";

export type BlockSyntaxView = SyntaxArenaView<BlockToken>;

export interface BlockSyntaxDocument {
  edit: (
    edits: readonly TextEdit[],
    change: BlockTokenChange,
  ) => void;
  view: (tokens: readonly BlockToken[]) => BlockSyntaxView;
}

export interface BlockSyntaxParser {
  parse: (source: string, tokens: readonly BlockToken[]) => BlockSyntaxDocument;
}

export function createBlockSyntaxParser(): BlockSyntaxParser {
  const parser = generatedBlocks.createParser();
  return {
    parse(source, tokens) {
      const handle = parser.parseTokens(source, tokens);
      return {
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
  };
}
