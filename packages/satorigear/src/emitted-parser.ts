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

interface EmittedParserModule<Handle extends EmittedParserHandle> {
  createParser: () => EmittedParserInstance<Handle>;
  parseTokens: (source: string, tokens: readonly Token[], entryRule?: string) => number;
  tree: ArenaTree;
}

interface EmittedParserHandle {
  root: number;
}

interface EmittedParserInstance<Handle extends EmittedParserHandle> {
  editTokens: (
    handle: Handle,
    edits: readonly { end: number; start: number; text: string }[],
    change: { oldEnd: number; oldStart: number; tokens: readonly Token[] },
  ) => void;
  parseTokens: (source: string, tokens: readonly Token[], entryRule?: string) => Handle;
  tree: ArenaTree;
}

export interface CstParserDocument {
  readonly rootId: number;

  edit: (
    edits: readonly { end: number; start: number; text: string }[],
    change: { oldEnd: number; oldStart: number; tokens: readonly Token[] },
  ) => void;
  toCst: (source: string, tokens: readonly Token[]) => CstNode;
}

export interface CstParser {
  createDocument: (source: string, tokens: readonly Token[], entryRule?: string) => CstParserDocument;
  parse: (source: string, entryRule?: string) => CstNode;
  parseTokens: (source: string, tokens: readonly Token[], entryRule?: string) => CstNode;
  tokenize: (source: string) => Token[];
}

function createCstDocument<Handle extends EmittedParserHandle>(
  runtime: EmittedParserModule<Handle>,
  source: string,
  tokens: readonly Token[],
  entryRule?: string,
): CstParserDocument {
  const parser = runtime.createParser();
  const handle = parser.parseTokens(source, tokens, entryRule);
  return {
    get rootId() {
      return handle.root;
    },
    edit: (edits, change) => parser.editTokens(handle, edits, change),
    toCst: (currentSource, currentTokens) => {
      const offset = currentTokens[0]?.ranges?.[0]?.offset ?? currentTokens[0]?.offset ?? 0;
      return materializeNode(handle.root, offset, 0, currentSource, currentTokens, parser.tree);
    },
  };
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

export function createCstParser<Handle extends EmittedParserHandle>(
  runtime: EmittedParserModule<Handle>,
  tokenize: (source: string) => Token[],
): CstParser {
  const parseTokens = (source: string, tokens: readonly Token[], entryRule?: string): CstNode => {
    const root = runtime.parseTokens(source, tokens, entryRule);
    const offset = tokens[0]?.ranges?.[0]?.offset ?? tokens[0]?.offset ?? 0;
    return materializeNode(root, offset, 0, source, tokens, runtime.tree);
  };
  return {
    createDocument: (source, tokens, entryRule) => createCstDocument(runtime, source, tokens, entryRule),
    parse: (source, entryRule) => parseTokens(source, tokenize(source), entryRule),
    parseTokens,
    tokenize,
  };
}
