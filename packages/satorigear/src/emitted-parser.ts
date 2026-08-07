import type { CstLeaf, CstNode } from "monogram/cst.ts";
import type { Token } from "monogram/gen-lexer.ts";

interface ArenaTree {
  childAt: (id: number, index: number) => number;
  childCount: (id: number) => number;
  childRelAt: (id: number, index: number) => number;
  childTokRelAt: (id: number, index: number) => number;
  leafKindOf: (entry: number) => number;
  leafToken: (entry: number, tokenBase: number) => number;
  lenOf: (id: number) => number;
  ruleNameOf: (id: number) => string;
}

interface EmittedParserModule {
  parseTokens: (source: string, tokens: readonly Token[], entryRule?: string) => number;
  tree: ArenaTree;
}

export interface CstParser {
  parse: (source: string, entryRule?: string) => CstNode;
  parseTokens: (source: string, tokens: readonly Token[], entryRule?: string) => CstNode;
  tokenize: (source: string) => Token[];
}

function leafTokenType(entry: number, token: Token, tree: ArenaTree): string {
  const kind = tree.leafKindOf(entry);
  if (kind === 1) {
    return "$keyword";
  }
  if (kind === 2) {
    return "$operator";
  }
  return token.type || "$punct";
}

function materializeLeaf(entry: number, token: Token, source: string, tree: ArenaTree): CstLeaf {
  const ranges = token.ranges?.map((range) => ({ ...range }));
  const offset = ranges?.[0]?.offset ?? token.offset;
  const end = ranges?.at(-1)?.end ?? token.offset + token.text.length;
  const physical = ranges?.map((range) => source.slice(range.offset, range.end)).join("");
  return {
    tokenType: leafTokenType(entry, token, tree),
    offset,
    end,
    ...(ranges?.length ? { ranges } : {}),
    ...(physical != null && physical !== token.text ? { value: token.text } : {}),
  };
}

function materializeNode(
  id: number,
  offset: number,
  tokenBase: number,
  source: string,
  tokens: readonly Token[],
  tree: ArenaTree,
): CstNode {
  const children = Array.from({ length: tree.childCount(id) }, (_, index) => {
    const entry = tree.childAt(id, index);
    if (entry < 0) {
      const token = tokens[tree.leafToken(entry, tokenBase)];
      if (!token) {
        throw new Error("emitted parser returned a leaf outside its token stream");
      }
      return materializeLeaf(entry, token, source, tree);
    }
    return materializeNode(
      entry,
      offset + tree.childRelAt(id, index),
      tokenBase + tree.childTokRelAt(id, index),
      source,
      tokens,
      tree,
    );
  });
  return {
    rule: tree.ruleNameOf(id),
    children,
    offset,
    end: offset + tree.lenOf(id),
  };
}

export function createCstParser(
  runtime: EmittedParserModule,
  tokenize: (source: string) => Token[],
): CstParser {
  const parseTokens = (source: string, tokens: readonly Token[], entryRule?: string): CstNode => {
    const root = runtime.parseTokens(source, tokens, entryRule);
    const offset = tokens[0]?.ranges?.[0]?.offset ?? tokens[0]?.offset ?? 0;
    return materializeNode(root, offset, 0, source, tokens, runtime.tree);
  };
  return {
    parse: (source, entryRule) => parseTokens(source, tokenize(source), entryRule),
    parseTokens,
    tokenize,
  };
}
