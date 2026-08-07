import type { CstChild, CstLeaf, CstNode } from "monogram/cst.ts";
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
  tree: (tokens: readonly Token[]) => CstTree;
  toCst: (source: string, tokens: readonly Token[]) => CstNode;
}

export interface CstTreeNode {
  id: number;
  kind: "node";
  offset: number;
  tokenBase: number;
  tree: CstTree;
}

export interface CstTreeLeaf {
  entry: number;
  kind: "leaf";
  token: number;
  tree: CstTree;
}

export type CstTreeEntry = CstTreeLeaf | CstTreeNode;

export interface CstTree {
  readonly root: CstTreeNode;

  children: (node: CstTreeNode) => readonly CstTreeEntry[];
  leafToken: (leaf: CstTreeLeaf) => Token;
  leafTokenType: (leaf: CstTreeLeaf) => string;
  ruleName: (node: CstTreeNode) => string;
  span: (entry: CstTreeEntry) => { end: number; start: number };
}

export interface CstParser {
  createDocument: (source: string, tokens: readonly Token[], entryRule?: string) => CstParserDocument;
  parse: (source: string, entryRule?: string) => CstNode;
  parseTree: (source: string, tokens: readonly Token[], entryRule?: string) => CstTree;
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
  const tree = (currentTokens: readonly Token[]): CstTree => createCstTree(handle.root, currentTokens, parser.tree);
  return {
    get rootId() {
      return handle.root;
    },
    edit: (edits, change) => parser.editTokens(handle, edits, change),
    tree,
    toCst: (currentSource, currentTokens) => materializeCst(tree(currentTokens), currentSource),
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

function materializeLeaf(leaf: CstTreeLeaf, source: string, tree: CstTree): CstLeaf {
  const token = tree.leafToken(leaf);
  const ranges = token.ranges?.map((range) => ({ ...range }));
  const offset = ranges?.[0]?.offset ?? token.offset;
  const end = ranges?.at(-1)?.end ?? token.offset + token.text.length;
  const physical = ranges?.map((range) => source.slice(range.offset, range.end)).join("");
  return {
    tokenType: tree.leafTokenType(leaf),
    offset,
    end,
    ...(ranges?.length ? { ranges } : {}),
    ...(physical != null && physical !== token.text ? { value: token.text } : {}),
  };
}

function createCstTree(
  rootId: number,
  tokens: readonly Token[],
  tree: ArenaTree,
): CstTree {
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
  } as CstTreeNode;
  const result: CstTree = {
    root,
    children: (node) => Array.from({ length: tree.childCount(node.id) }, (_, index) => {
      const entry = tree.childAt(node.id, index);
      if (entry < 0) {
        return {
          kind: "leaf",
          entry,
          token: tree.leafToken(entry, node.tokenBase),
          tree: result,
        } satisfies CstTreeLeaf;
      }
      return {
        kind: "node",
        id: entry,
        offset: node.offset + tree.childRelAt(node.id, index),
        tokenBase: node.tokenBase + tree.childTokRelAt(node.id, index),
        tree: result,
      } satisfies CstTreeNode;
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

type CstChildrenTransform = (node: CstTreeNode, children: CstChild[]) => CstChild[];

export function materializeCstNode(
  tree: CstTree,
  source: string,
  root: CstTreeNode,
  transformChildren?: CstChildrenTransform,
): CstNode {
  const visit = (node: CstTreeNode): CstNode => {
    const span = tree.span(node);
    const children = tree.children(node).map((child) => (
      child.kind === "node" ? visit(child) : materializeLeaf(child, source, tree)
    ));
    return {
      rule: tree.ruleName(node),
      children: transformChildren?.(node, children) ?? children,
      offset: span.start,
      end: span.end,
    };
  };
  return visit(root);
}

export function materializeCst(
  tree: CstTree,
  source: string,
  transformChildren?: CstChildrenTransform,
): CstNode {
  return materializeCstNode(tree, source, tree.root, transformChildren);
}

export function createCstParser<Handle extends EmittedParserHandle>(
  runtime: EmittedParserModule<Handle>,
  tokenize: (source: string) => Token[],
): CstParser {
  const parseTree = (source: string, tokens: readonly Token[], entryRule?: string): CstTree => {
    const root = runtime.parseTokens(source, tokens, entryRule);
    return createCstTree(root, tokens, runtime.tree);
  };
  const parseTokens = (source: string, tokens: readonly Token[], entryRule?: string): CstNode => (
    materializeCst(parseTree(source, tokens, entryRule), source)
  );
  return {
    createDocument: (source, tokens, entryRule) => createCstDocument(runtime, source, tokens, entryRule),
    parse: (source, entryRule) => parseTokens(source, tokenize(source), entryRule),
    parseTree,
    parseTokens,
    tokenize,
  };
}
