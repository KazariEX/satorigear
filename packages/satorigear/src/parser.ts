import type { Token } from "monogram/gen-lexer.ts";
import { createDelimitedTokenResolver } from "./delimiter-parser.ts";
import {
  createEmittedParser,
  type EmittedDocument,
  type SyntaxTree,
  type SyntaxTreeEntry,
  type SyntaxTreeLeaf,
  type SyntaxTreeNode,
} from "./emitted-parser.ts";
import * as blockRuntime from "./generated/blocks.ts";
import * as inlineRuntime from "./generated/inline.ts";
import { tokenizeMarkdownBlocks } from "./grammar-blocks.ts";
import {
  markdownBracketPairs,
  markdownDelimiterRuns,
  normalizeMarkdownReferenceLabel,
  reassociateMarkdownReferenceTails,
} from "./grammar-inline.ts";
import { createSourceView, type SourceRange, type SourceView } from "./source-view.ts";
import { changedTokenRange } from "./token-change.ts";
import type {
  MarkdownSyntax,
  MarkdownSyntaxChild,
  MarkdownSyntaxLeaf,
  MarkdownSyntaxNode,
} from "./mdast.ts";

export const markdownBlockParser = createEmittedParser(blockRuntime, tokenizeMarkdownBlocks);
const inlineParser = createEmittedParser(inlineRuntime, inlineRuntime.tokenize);
const inlineResolver = createDelimitedTokenResolver(markdownDelimiterRuns, markdownBracketPairs);

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

function tokenizeInline(source: string, referenceLabels: ReadonlySet<string>): { candidates: Set<string>; tokens: readonly Token[] } {
  const candidates = new Set<string>();
  const tokens = reassociateMarkdownReferenceTails(source, inlineParser.tokenize(source), referenceLabels);
  return {
    candidates,
    tokens: inlineResolver.resolve(source, tokens, { labels: referenceLabels, candidates }),
  };
}

interface InlineRegion {
  candidates: ReadonlySet<string>;
  document?: EmittedDocument;
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
  node: SyntaxTreeNode;
  offset: number;
  regionIds: readonly number[];
  regionRevisions: readonly number[];
  source: string;
  syntax: MarkdownSyntax;
  version: number;
}

type CollectedBlock = Omit<CompositeBlockDescriptor, "regionRevisions" | "syntax" | "version">;

function rangesOf(tree: SyntaxTree, node: SyntaxTreeNode): SourceRange[] {
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
  for (const value of left) {
    if (right.has(value)) {
      return true;
    }
  }
  return false;
}

function sameNumbers(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

class MarkdownCompositeDocument implements MarkdownSyntax {
  #blocks: readonly CompositeBlockDescriptor[] = [];
  #labels = new Set<string>();
  #inlineTrees = new WeakMap<SyntaxTree, InlineRegion>();
  #regions = new Map<number, InlineRegion>();
  #source: string;
  #tree: SyntaxTree;

  constructor(tree: SyntaxTree, source: string) {
    this.#tree = tree;
    this.#source = source;
    this.update(tree, source);
  }

  blocks(): readonly CompositeBlockDescriptor[] {
    return this.#blocks;
  }

  update(tree: SyntaxTree, source: string): void {
    const labels = new Set<string>();
    const descriptors: InlineRegionDescriptor[] = [];
    const blocks: CollectedBlock[] = [];
    const collect = (node: SyntaxTreeNode, regionIds: number[]): void => {
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
    const previousBlocks = new Map(this.#blocks.map((block) => [block.id, block]));
    const nextBlocks = blocks.map((block): CompositeBlockDescriptor => {
      const previous = previousBlocks.get(block.id);
      const regionRevisions = block.regionIds.map((id) => {
        const region = regions.get(id);
        if (!region) {
          throw new Error(`Block references missing inline region ${id}`);
        }
        return region.revision;
      });
      const unchanged = previous?.source === block.source
        && sameNumbers(previous.regionIds, block.regionIds)
        && sameNumbers(previous.regionRevisions, regionRevisions);
      return {
        ...block,
        regionRevisions,
        syntax: this,
        version: unchanged ? previous.version : (previous?.version ?? -1) + 1,
      };
    });
    this.#tree = tree;
    this.#source = source;
    this.#blocks = nextBlocks;
    this.#labels = labels;
    this.#regions = regions;
  }

  children(value: MarkdownSyntaxNode): readonly MarkdownSyntaxChild[] {
    const node = value as SyntaxTreeNode;
    return node.tree.children(node);
  }

  inline(value: MarkdownSyntaxNode): MarkdownSyntaxNode | undefined {
    const node = value as SyntaxTreeNode;
    if (node.tree !== this.#tree) {
      return;
    }
    const region = this.#regions.get(node.id);
    if (!region) {
      return;
    }
    const tree = region.document
      ? region.document.tree(region.tokens)
      : inlineParser.parseTree(region.view.text, region.tokens, "InlineLines");
    this.#inlineTrees.set(tree, region);
    return tree.root;
  }

  isLeaf(value: MarkdownSyntaxChild): value is MarkdownSyntaxLeaf {
    return (value as SyntaxTreeEntry).kind === "leaf";
  }

  ranges(value: MarkdownSyntaxLeaf): readonly SourceRange[] {
    const leaf = value as SyntaxTreeLeaf;
    const token = leaf.tree.leafToken(leaf);
    const ranges = token.ranges ?? [{ offset: token.offset, end: token.offset + token.text.length }];
    const region = this.#regionOf(leaf);
    return region ? ranges.flatMap((range) => region.view.mapRange(range.offset, range.end)) : ranges;
  }

  rule(value: MarkdownSyntaxNode): string {
    const node = value as SyntaxTreeNode;
    return node.tree.ruleName(node);
  }

  span(value: MarkdownSyntaxChild): { end: number; start: number } {
    const entry = value as SyntaxTreeEntry;
    const span = entry.tree.span(entry);
    const region = this.#regionOf(entry);
    if (!region) {
      return span;
    }
    const ranges = region.view.mapRange(span.start, span.end);
    if (ranges.length === 0) {
      const point = region.view.mapPoint(span.start);
      return { start: point, end: point };
    }
    return { start: ranges[0].offset, end: ranges.at(-1)!.end };
  }

  text(value: MarkdownSyntaxChild): string {
    const entry = value as SyntaxTreeEntry;
    if (entry.kind === "leaf") {
      return entry.tree.leafToken(entry).text;
    }
    const span = entry.tree.span(entry);
    return (this.#regionOf(entry)?.view.text ?? this.#source).slice(span.start, span.end);
  }

  tokenType(value: MarkdownSyntaxLeaf): string {
    const leaf = value as SyntaxTreeLeaf;
    return leaf.tree.leafTokenType(leaf);
  }

  #regionOf(value: SyntaxTreeEntry): InlineRegion | undefined {
    return this.#inlineTrees.get(value.tree);
  }
}

export function createMarkdownCompositeDocument(tree: SyntaxTree, source: string): MarkdownCompositeDocument {
  return new MarkdownCompositeDocument(tree, source);
}
