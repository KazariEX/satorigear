import { createCompositeParser, rebaseCst } from "monogram/composite-parser.ts";
import { type CstNode, getText } from "monogram/cst.ts";
import { resolveDelimitedTokens } from "monogram/delimiter-parser.ts";
import { createLexer, type Token } from "monogram/gen-lexer.ts";
import { createSourceView, type SourceRange, type SourceView } from "monogram/source-view.ts";
import {
  createCstParser,
  type CstParserDocument,
  type CstTree,
  type CstTreeNode,
  materializeCst,
  materializeCstNode,
} from "./emitted-parser.ts";
import * as blockRuntime from "./generated/blocks.ts";
import * as inlineRuntime from "./generated/inline.ts";
import { tokenizeMarkdownBlocks } from "./grammar-blocks.ts";
import {
  markdownBracketPairs,
  markdownDelimiterRuns,
  markdownInlineGrammar,
  normalizeMarkdownReferenceLabel,
  reassociateMarkdownReferenceTails,
} from "./grammar-inline.ts";
import { changedTokenRange } from "./token-change.ts";

export const markdownBlockParser = createCstParser(blockRuntime, tokenizeMarkdownBlocks);
const inlineParser = createCstParser(inlineRuntime, createLexer(markdownInlineGrammar).tokenize);

function referenceLabel(definition: CstNode, source: string): string | null {
  return referenceLabelText(getText(definition, source));
}

function referenceLabelText(text: string): string | null {
  const open = text.indexOf("[");
  if (open < 0) {
    return null;
  }
  for (let offset = open + 1; offset < text.length; offset++) {
    if (text[offset] === "\\") {
      offset++;
    }
    else if (text[offset] === "]") {
      return normalizeMarkdownReferenceLabel(text.slice(open + 1, offset));
    }
  }
  return null;
}

function collectReferenceLabels(root: CstNode, source: string): Set<string> {
  const labels = new Set<string>();
  const visit = (node: CstNode): void => {
    if (node.rule === "LinkDefinition") {
      const label = referenceLabel(node, source);
      if (label) {
        labels.add(label);
      }
      return;
    }
    for (const child of node.children) {
      if (!("tokenType" in child)) {
        visit(child);
      }
    }
  };
  visit(root);
  return labels;
}

function inlineParserFor(referenceLabels: ReadonlySet<string>) {
  return {
    parse: (source: string, entryRule?: string) => {
      return inlineParser.parseTokens(source, tokenizeInline(source, referenceLabels).tokens, entryRule);
    },
  };
}

function tokenizeInline(source: string, referenceLabels: ReadonlySet<string>): { candidates: Set<string>; tokens: Token[] } {
  const candidates = new Set<string>();
  const pairs = markdownBracketPairs(referenceLabels, candidates);
  const tokens = reassociateMarkdownReferenceTails(source, inlineParser.tokenize(source), referenceLabels);
  return { candidates, tokens: resolveDelimitedTokens(source, tokens, markdownDelimiterRuns, pairs) };
}

/**
 * Block-first Markdown parser under development. It runs beside the legacy single-pass grammar
 * until its CommonMark block baseline is high enough to become the package default.
 */
export const markdownPhasedParser = createCompositeParser({
  outer: markdownBlockParser,
  prepare: collectReferenceLabels,
  regions: [{
    within: ["Paragraph", "AtxHeading", "SetextHeading"],
    contentToken: "InlineChunk",
    inner: inlineParserFor,
    entryRule: "InlineLines",
  }],
});

interface InlineRegion {
  candidates: ReadonlySet<string>;
  document?: CstParserDocument;
  id: number;
  revision: number;
  rule: string;
  span: { end: number; start: number };
  tokens: readonly Token[];
  view: SourceView;
}

interface InlineRegionDescriptor {
  id: number;
  rule: string;
  span: { end: number; start: number };
  view: SourceView;
}

interface CompositeBlockDescriptor {
  id: number;
  node: CstTreeNode;
  offset: number;
  regionIds: readonly number[];
  source: string;
}

function rangesOf(tree: CstTree, node: CstTreeNode): SourceRange[] {
  return tree.children(node).flatMap((child) => {
    if (child.kind === "node" || tree.leafTokenType(child) !== "InlineChunk") {
      return [];
    }
    const token = tree.leafToken(child);
    return token.ranges?.length ? [...token.ranges] : [{ offset: token.offset, end: token.offset + token.text.length }];
  });
}

function textEdit(previous: string, next: string): readonly { end: number; start: number; text: string }[] {
  let start = 0;
  const common = Math.min(previous.length, next.length);
  while (start < common && previous[start] === next[start]) {
    start++;
  }
  let suffix = 0;
  while (suffix < common - start && previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]) {
    suffix++;
  }
  if (start === previous.length && start === next.length) {
    return [];
  }
  return [{
    start,
    end: previous.length - suffix,
    text: next.slice(start, next.length - suffix),
  }];
}

function createInlineRegion(descriptor: InlineRegionDescriptor, labels: ReadonlySet<string>): InlineRegion {
  const inline = tokenizeInline(descriptor.view.text, labels);
  return {
    ...descriptor,
    candidates: inline.candidates,
    revision: 0,
    tokens: inline.tokens,
  };
}

function updateInlineRegion(
  region: InlineRegion,
  descriptor: InlineRegionDescriptor,
  labels: ReadonlySet<string>,
  referencesChanged: boolean,
): InlineRegion {
  if (!referencesChanged && region.view.text === descriptor.view.text) {
    return { ...region, ...descriptor };
  }
  const edits = textEdit(region.view.text, descriptor.view.text);
  const inline = tokenizeInline(descriptor.view.text, labels);
  const change = changedTokenRange(region.tokens, inline.tokens, descriptor.view.text.length - region.view.text.length);
  let document = region.document;
  if (edits.length > 0 || change.oldStart !== change.oldEnd || change.tokens.length > 0) {
    if (document) {
      document.edit(edits, change);
    }
    else {
      document = inlineParser.createDocument(descriptor.view.text, inline.tokens, "InlineLines");
    }
  }
  return {
    ...region,
    ...descriptor,
    candidates: inline.candidates,
    document,
    revision: region.revision + 1,
    tokens: inline.tokens,
  };
}

function changedLabels(previous: ReadonlySet<string>, next: ReadonlySet<string>): Set<string> {
  const changed = new Set<string>();
  for (const label of previous) {
    if (!next.has(label)) {
      changed.add(label);
    }
  }
  for (const label of next) {
    if (!previous.has(label)) {
      changed.add(label);
    }
  }
  return changed;
}

function intersects(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return [...left].some((value) => right.has(value));
}

class MarkdownCompositeDocument {
  #blocks: readonly CompositeBlockDescriptor[] = [];
  #labels = new Set<string>();
  #regions = new Map<number, InlineRegion>();
  #source: string;
  #tree: CstTree;

  constructor(tree: CstTree, source: string) {
    this.#tree = tree;
    this.#source = source;
    this.update(tree, source);
  }

  inlineDocuments(): readonly CstParserDocument[] {
    return [...this.#regions.values()].map((region) => {
      region.document ??= inlineParser.createDocument(region.view.text, region.tokens, "InlineLines");
      return region.document;
    });
  }

  inlineRevisions(): readonly number[] {
    return [...this.#regions.values()].map((region) => region.revision);
  }

  blocks(): readonly {
    id: number;
    materialize: () => CstNode;
    offset: number;
    source: string;
    version: string;
  }[] {
    return this.#blocks.map((block) => ({
      id: block.id,
      materialize: () => {
        const node = materializeCstNode(this.#tree, this.#source, block.node);
        this.#attach(block.node, node);
        return node;
      },
      offset: block.offset,
      source: block.source,
      version: block.regionIds.map((id) => `${id}:${this.#regions.get(id)?.revision}`).join("|"),
    }));
  }

  update(tree: CstTree, source: string): void {
    const labels = new Set<string>();
    const descriptors: InlineRegionDescriptor[] = [];
    const blocks: CompositeBlockDescriptor[] = [];
    const collect = (node: CstTreeNode, regionIds: number[]): void => {
      const rule = tree.ruleName(node);
      if (rule === "LinkDefinition") {
        const span = tree.span(node);
        const label = referenceLabelText(source.slice(span.start, span.end));
        if (label) {
          labels.add(label);
        }
        return;
      }
      if (rule === "Paragraph" || rule === "AtxHeading" || rule === "SetextHeading") {
        const ranges = rangesOf(tree, node);
        if (ranges.length > 0) {
          descriptors.push({ id: node.id, rule, span: tree.span(node), view: createSourceView(source, ranges) });
          regionIds.push(node.id);
        }
        return;
      }
      for (const child of tree.children(node)) {
        if (child.kind === "node") {
          collect(child, regionIds);
        }
      }
    };
    for (const child of tree.children(tree.root)) {
      if (child.kind !== "node" || tree.ruleName(child) !== "Block") {
        continue;
      }
      const span = tree.span(child);
      const regionIds: number[] = [];
      collect(child, regionIds);
      blocks.push({
        id: child.id,
        node: child,
        offset: child.offset,
        regionIds,
        source: source.slice(span.start, span.end),
      });
    }

    const changed = changedLabels(this.#labels, labels);
    const regions = new Map<number, InlineRegion>();
    const stableIds = new Set(descriptors.map((descriptor) => descriptor.id));
    const available = [...this.#regions.values()].filter((region) => !stableIds.has(region.id));
    for (const descriptor of descriptors) {
      let previous = this.#regions.get(descriptor.id);
      if (!previous) {
        let nearest = -1;
        let distance = Number.POSITIVE_INFINITY;
        for (let index = 0; index < available.length; index++) {
          const candidate = available[index];
          const candidateDistance = candidate.rule === descriptor.rule
            ? Math.abs(candidate.span.start - descriptor.span.start)
            : Number.POSITIVE_INFINITY;
          if (candidateDistance < distance) {
            distance = candidateDistance;
            nearest = index;
          }
        }
        if (nearest >= 0) {
          previous = available.splice(nearest, 1)[0];
        }
      }
      const region = previous
        ? updateInlineRegion(previous, descriptor, labels, intersects(previous.candidates, changed))
        : createInlineRegion(descriptor, labels);
      regions.set(descriptor.id, region);
    }
    this.#tree = tree;
    this.#source = source;
    this.#blocks = blocks;
    this.#labels = labels;
    this.#regions = regions;
  }

  toCst(): CstNode {
    const root = materializeCst(this.#tree, this.#source);
    this.#attach(this.#tree.root, root);
    return root;
  }

  #attach(arenaNode: CstTreeNode, node: CstNode): void {
    const region = this.#regions.get(arenaNode.id);
    if (region) {
      const local = region.document
        ? region.document.toCst(region.view.text, region.tokens)
        : inlineParser.parseTokens(region.view.text, region.tokens, "InlineLines");
      const inner = rebaseCst(local, region.view);
      let inserted = false;
      node.children = node.children.flatMap((child) => {
        if (!("tokenType" in child) || child.tokenType !== "InlineChunk") {
          return [child];
        }
        if (inserted) {
          return [];
        }
        inserted = true;
        return [inner];
      });
      return;
    }
    const arenaChildren = this.#tree.children(arenaNode);
    for (let index = 0; index < arenaChildren.length; index++) {
      const arenaChild = arenaChildren[index];
      const child = node.children[index];
      if (arenaChild.kind === "node" && child && !("tokenType" in child)) {
        this.#attach(arenaChild, child);
      }
    }
  }
}

export function createMarkdownCompositeDocument(tree: CstTree, source: string): MarkdownCompositeDocument {
  return new MarkdownCompositeDocument(tree, source);
}
