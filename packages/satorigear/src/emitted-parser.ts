import type { Token } from "monogram/gen-lexer.ts";
import type { TextEdit } from "./text-edit.ts";

export interface EmittedArena {
  childAt: (id: number, index: number) => number;
  childCount: (id: number) => number;
  childRelAt: (id: number, index: number) => number;
  childTokRelAt: (id: number, index: number) => number;
  leafToken: (entry: number, tokenBase: number) => number;
  leafTokenType: (entry: number, tokenBase: number) => string;
  lenOf: (id: number) => number;
  ruleNameOf: (id: number) => string;
}

export interface EmittedParserModule<Handle extends EmittedParserHandle> {
  createParser: () => EmittedParserInstance<Handle>;
  parseTokens: (source: string, tokens: readonly Token[], entryRule?: string) => number;
  tree: EmittedArena;
}

export interface EmittedParserHandle {
  root: number;
}

interface EmittedParserInstance<Handle extends EmittedParserHandle> {
  editTokens: (
    handle: Handle,
    edits: readonly TextEdit[],
    change: { oldEnd: number; oldStart: number; tokens: readonly Token[] },
  ) => void;
  parseTokens: (source: string, tokens: readonly Token[], entryRule?: string) => Handle;
  tree: EmittedArena;
}

export interface EmittedParserDocument {
  readonly rootId: number;

  edit: (
    edits: readonly TextEdit[],
    change: { oldEnd: number; oldStart: number; tokens: readonly Token[] },
  ) => void;
  tree: (tokens: readonly Token[]) => SyntaxTree;
}

export interface SyntaxTreeRoot {
  id: number;
  offset: number;
  tokenBase: number;
}

export interface SyntaxTree {
  readonly arena: EmittedArena;
  readonly root: SyntaxTreeRoot;

  tokenAt: (index: number) => Token;
}

export interface EmittedParser {
  createDocument: (source: string, tokens: readonly Token[], entryRule?: string) => EmittedParserDocument;
  parseTree: (source: string, tokens: readonly Token[], entryRule?: string) => SyntaxTree;
  tokenize: (source: string) => Token[];
}

function createEmittedParserDocument<Handle extends EmittedParserHandle>(
  runtime: EmittedParserModule<Handle>,
  source: string,
  tokens: readonly Token[],
  entryRule?: string,
): EmittedParserDocument {
  const parser = runtime.createParser();
  const handle = parser.parseTokens(source, tokens, entryRule);
  const tree = (currentTokens: readonly Token[]): SyntaxTree => createArenaView(handle.root, currentTokens, parser.tree);
  return {
    get rootId() {
      return handle.root;
    },
    edit: (edits, change) => parser.editTokens(handle, edits, change),
    tree,
  };
}

function createArenaView(
  rootId: number,
  tokens: readonly Token[],
  tree: EmittedArena,
): SyntaxTree {
  const tokenAt = (index: number): Token => {
    const token = tokens[index];
    if (!token) {
      throw new Error("emitted parser returned a leaf outside its token stream");
    }
    return token;
  };
  const tokenOffset = (token: Token): number => token.ranges?.[0]?.offset ?? token.offset;
  const root = {
    id: rootId,
    offset: tokens[0] ? tokenOffset(tokens[0]) : 0,
    tokenBase: 0,
  };
  return {
    arena: tree,
    root,
    tokenAt,
  };
}

export function createEmittedParser<Handle extends EmittedParserHandle>(
  runtime: EmittedParserModule<Handle>,
  tokenize: (source: string) => Token[],
): EmittedParser {
  const parseTree = (source: string, tokens: readonly Token[], entryRule?: string): SyntaxTree => {
    const root = runtime.parseTokens(source, tokens, entryRule);
    return createArenaView(root, tokens, runtime.tree);
  };
  return {
    createDocument: (source, tokens, entryRule) => createEmittedParserDocument(runtime, source, tokens, entryRule),
    parseTree,
    tokenize,
  };
}
