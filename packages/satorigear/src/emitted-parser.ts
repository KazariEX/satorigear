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
  view: (tokens: readonly Token[]) => SyntaxArenaView;
}

export interface SyntaxArenaRoot {
  id: number;
  offset: number;
  tokenBase: number;
}

export interface SyntaxArenaView {
  readonly arena: EmittedArena;
  readonly root: SyntaxArenaRoot;

  tokenAt: (index: number) => Token;
}

export interface EmittedParser {
  // Stateless parses expose their module arena directly because callers consume it before the next parse.
  readonly arena: EmittedArena;

  createDocument: (source: string, tokens: readonly Token[], entryRule?: string) => EmittedParserDocument;
  parseTokens: (source: string, tokens: readonly Token[], entryRule?: string) => number;
}

function createEmittedParserDocument<Handle extends EmittedParserHandle>(
  createParser: () => EmittedParserInstance<Handle>,
  source: string,
  tokens: readonly Token[],
  entryRule?: string,
): EmittedParserDocument {
  const parser = createParser();
  const handle = parser.parseTokens(source, tokens, entryRule);
  const view = (currentTokens: readonly Token[]): SyntaxArenaView => createArenaView(handle.root, currentTokens, parser.tree);
  return {
    get rootId() {
      return handle.root;
    },
    edit: (edits, change) => parser.editTokens(handle, edits, change),
    view,
  };
}

function createArenaView(
  rootId: number,
  tokens: readonly Token[],
  arena: EmittedArena,
): SyntaxArenaView {
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
    arena,
    root,
    tokenAt,
  };
}

export function createEmittedParser<Handle extends EmittedParserHandle>(
  arena: EmittedArena,
  createParser: () => EmittedParserInstance<Handle>,
  parseTokens: (source: string, tokens: readonly Token[], entryRule?: string) => number,
): EmittedParser {
  return {
    arena,
    createDocument: (createEmittedParserDocument<Handle>).bind(void 0, createParser),
    parseTokens,
  };
}
