import type { Token } from "monogram/gen-lexer.ts";
import type { TextEdit } from "./text-edit.ts";

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

export interface EmittedParserModule<Handle extends EmittedParserHandle> {
  createParser: () => EmittedParserInstance<Handle>;
  parseTokens: (source: string, tokens: readonly Token[], entryRule?: string) => number;
  tree: ArenaTree;
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
  tree: ArenaTree;
}

export interface EmittedParserDocument {
  readonly rootId: number;

  edit: (
    edits: readonly TextEdit[],
    change: { oldEnd: number; oldStart: number; tokens: readonly Token[] },
  ) => void;
  tree: (tokens: readonly Token[]) => SyntaxTree;
}

export interface SyntaxTreeNode {
  id: number;
  kind: "node";
  offset: number;
  tokenBase: number;
  tree: SyntaxTree;
}

export interface SyntaxTreeLeaf {
  entry: number;
  kind: "leaf";
  token: number;
  tree: SyntaxTree;
}

export type SyntaxTreeEntry = SyntaxTreeLeaf | SyntaxTreeNode;

export interface SyntaxTree {
  readonly root: SyntaxTreeNode;

  children: (node: SyntaxTreeNode) => readonly SyntaxTreeEntry[];
  leafToken: (leaf: SyntaxTreeLeaf) => Token;
  leafTokenType: (leaf: SyntaxTreeLeaf) => string;
  ruleName: (node: SyntaxTreeNode) => string;
  span: (entry: SyntaxTreeEntry) => { end: number; start: number };
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
  const tree = (currentTokens: readonly Token[]): SyntaxTree => createSyntaxTree(handle.root, currentTokens, parser.tree);
  return {
    get rootId() {
      return handle.root;
    },
    edit: (edits, change) => parser.editTokens(handle, edits, change),
    tree,
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

function createSyntaxTree(
  rootId: number,
  tokens: readonly Token[],
  tree: ArenaTree,
): SyntaxTree {
  const tokenAt = (index: number): Token => {
    const token = tokens[index];
    if (!token) {
      throw new Error("emitted parser returned a leaf outside its token stream");
    }
    return token;
  };
  const tokenOffset = (token: Token): number => token.ranges?.[0]?.offset ?? token.offset;
  const tokenEnd = (token: Token): number => token.ranges?.at(-1)?.end ?? token.offset + token.text.length;
  const root = {
    kind: "node",
    id: rootId,
    offset: tokens[0] ? tokenOffset(tokens[0]) : 0,
    tokenBase: 0,
  } as SyntaxTreeNode;
  const result: SyntaxTree = {
    root,
    children: (node) => Array.from({ length: tree.childCount(node.id) }, (_, index) => {
      const entry = tree.childAt(node.id, index);
      if (entry < 0) {
        return {
          kind: "leaf",
          entry,
          token: tree.leafToken(entry, node.tokenBase),
          tree: result,
        } satisfies SyntaxTreeLeaf;
      }
      return {
        kind: "node",
        id: entry,
        offset: node.offset + tree.childRelAt(node.id, index),
        tokenBase: node.tokenBase + tree.childTokRelAt(node.id, index),
        tree: result,
      } satisfies SyntaxTreeNode;
    }),
    leafToken: (leaf) => tokenAt(leaf.token),
    leafTokenType: (leaf) => leafTokenType(leaf.entry, tokenAt(leaf.token), tree),
    ruleName: (node) => tree.ruleNameOf(node.id),
    span: (entry) => {
      if (entry.kind === "node") {
        return { start: entry.offset, end: entry.offset + tree.lenOf(entry.id) };
      }
      const token = tokenAt(entry.token);
      return { start: tokenOffset(token), end: tokenEnd(token) };
    },
  };
  root.tree = result;
  return result;
}

export function createEmittedParser<Handle extends EmittedParserHandle>(
  runtime: EmittedParserModule<Handle>,
  tokenize: (source: string) => Token[],
): EmittedParser {
  const parseTree = (source: string, tokens: readonly Token[], entryRule?: string): SyntaxTree => {
    const root = runtime.parseTokens(source, tokens, entryRule);
    return createSyntaxTree(root, tokens, runtime.tree);
  };
  return {
    createDocument: (source, tokens, entryRule) => createEmittedParserDocument(runtime, source, tokens, entryRule),
    parseTree,
    tokenize,
  };
}
