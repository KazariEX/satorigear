import type { Token } from "monogram/gen-lexer.ts";
import type { TextEdit } from "./text-edit.ts";
import type { TokenChange } from "./token-change.ts";

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
    change: TokenChange,
  ) => void;
  parseTokens: (source: string, tokens: readonly Token[], entryRule?: string) => Handle;
  tree: EmittedArena;
}

export interface EmittedParserDocument {
  readonly rootId: number;

  edit: (
    edits: readonly TextEdit[],
    change: TokenChange,
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
  return {
    get rootId() {
      return handle.root;
    },
    edit: (edits, change) => parser.editTokens(handle, edits, change),
    view: (currentTokens) => createArenaView(handle.root, currentTokens, parser.tree),
  };
}

function createArenaView(
  rootId: number,
  tokens: readonly Token[],
  arena: EmittedArena,
): SyntaxArenaView {
  return {
    arena,
    root: {
      id: rootId,
      offset: tokens[0]
        ? tokens[0].ranges?.[0]?.offset ?? tokens[0].offset
        : 0,
      tokenBase: 0,
    },
    tokenAt(index: number) {
      const token = tokens[index];
      if (!token) {
        throw new Error("emitted parser returned a leaf outside its token stream");
      }
      return token;
    },
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
