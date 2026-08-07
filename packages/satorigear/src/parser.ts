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

function sameLabels(previous: ReadonlySet<string>, next: ReadonlySet<string>): boolean {
  return previous.size === next.size && [...previous].every((label) => next.has(label));
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

function collectTreeReferenceLabels(tree: CstTree, source: string): Set<string> {
  const labels = new Set<string>();
  const visit = (node: CstTreeNode): void => {
    if (tree.ruleName(node) === "LinkDefinition") {
      const span = tree.span(node);
      const label = referenceLabelText(source.slice(span.start, span.end));
      if (label) {
        labels.add(label);
      }
      return;
    }
    for (const child of tree.children(node)) {
      if (child.kind === "node") {
        visit(child);
      }
    }
  };
  visit(tree.root);
  return labels;
}

function inlineParserFor(referenceLabels: ReadonlySet<string>) {
  return {
    parse: (source: string, entryRule?: string) => {
      return inlineParser.parseTokens(source, inlineTokens(source, referenceLabels), entryRule);
    },
  };
}

function inlineTokens(source: string, referenceLabels: ReadonlySet<string>): Token[] {
  const pairs = markdownBracketPairs(referenceLabels);
  const tokens = reassociateMarkdownReferenceTails(source, inlineParser.tokenize(source), referenceLabels);
  return resolveDelimitedTokens(source, tokens, markdownDelimiterRuns, pairs);
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
  document: CstParserDocument;
  id: number;
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
  const tokens = inlineTokens(descriptor.view.text, labels);
  return {
    ...descriptor,
    tokens,
    document: inlineParser.createDocument(descriptor.view.text, tokens, "InlineLines"),
  };
}

function updateInlineRegion(
  region: InlineRegion,
  descriptor: InlineRegionDescriptor,
  labels: ReadonlySet<string>,
  labelsChanged: boolean,
): InlineRegion {
  if (!labelsChanged && region.view.text === descriptor.view.text) {
    return { ...region, ...descriptor };
  }
  const edits = textEdit(region.view.text, descriptor.view.text);
  const tokens = inlineTokens(descriptor.view.text, labels);
  const change = changedTokenRange(region.tokens, tokens, descriptor.view.text.length - region.view.text.length);
  if (edits.length > 0 || change.oldStart !== change.oldEnd || change.tokens.length > 0) {
    region.document.edit(edits, change);
  }
  return { ...region, ...descriptor, tokens };
}

class MarkdownCompositeDocument {
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
    return [...this.#regions.values()].map((region) => region.document);
  }

  update(tree: CstTree, source: string): void {
    const labels = collectTreeReferenceLabels(tree, source);
    const labelsChanged = !sameLabels(this.#labels, labels);
    const descriptors: InlineRegionDescriptor[] = [];
    const collect = (node: CstTreeNode): void => {
      const rule = tree.ruleName(node);
      if (rule === "Paragraph" || rule === "AtxHeading" || rule === "SetextHeading") {
        const ranges = rangesOf(tree, node);
        if (ranges.length > 0) {
          descriptors.push({ id: node.id, rule, span: tree.span(node), view: createSourceView(source, ranges) });
        }
        return;
      }
      for (const child of tree.children(node)) {
        if (child.kind === "node") {
          collect(child);
        }
      }
    };
    collect(tree.root);

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
        ? updateInlineRegion(previous, descriptor, labels, labelsChanged)
        : createInlineRegion(descriptor, labels);
      regions.set(descriptor.id, region);
    }
    this.#tree = tree;
    this.#source = source;
    this.#labels = labels;
    this.#regions = regions;
  }

  toCst(): CstNode {
    const root = materializeCst(this.#tree, this.#source);
    const attach = (arenaNode: CstTreeNode, node: CstNode): void => {
      const region = this.#regions.get(arenaNode.id);
      if (region) {
        const inner = rebaseCst(region.document.toCst(region.view.text, region.tokens), region.view);
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
          attach(arenaChild, child);
        }
      }
    };
    attach(this.#tree.root, root);
    return root;
  }
}

export function createMarkdownCompositeDocument(tree: CstTree, source: string): MarkdownCompositeDocument {
  return new MarkdownCompositeDocument(tree, source);
}
