import {
  createEmittedParser,
  type EmittedParserDocument,
  type SyntaxTree,
  type SyntaxTreeEntry,
  type SyntaxTreeLeaf,
  type SyntaxTreeNode,
} from "./emitted-parser.ts";
import * as blockRuntime from "./generated/blocks.ts";
import * as inlineRuntime from "./generated/inline.ts";
import { tokenizeMarkdownBlocks } from "./grammar-blocks.ts";
import { normalizeMarkdownReferenceLabel } from "./grammar-inline.ts";
import { InlineTokenState } from "./inline-tokenizer.ts";
import {
  createSourceView,
  projectSourceEdits,
  type SourceRange,
  type SourceView,
} from "./source-view.ts";
import type {
  MarkdownSyntax,
  MarkdownSyntaxChild,
  MarkdownSyntaxLeaf,
  MarkdownSyntaxNode,
} from "./mdast.ts";
import type { TextEdit } from "./text-edit.ts";

export const blockParser = createEmittedParser(blockRuntime, tokenizeMarkdownBlocks);
const inlineParser = createEmittedParser(inlineRuntime, inlineRuntime.tokenize);

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

interface InlineRegionDescriptor {
  id: number;
  rule: string;
  span: { end: number; start: number };
  view: SourceView;
}

class InlineRegion extends InlineTokenState {
  document?: EmittedParserDocument;
  id: number;
  revision = 0;
  rule: string;
  span: { end: number; start: number };
  view: SourceView;

  constructor(descriptor: InlineRegionDescriptor, labels: ReadonlySet<string>) {
    super();
    this.id = descriptor.id;
    this.rule = descriptor.rule;
    this.span = descriptor.span;
    this.view = descriptor.view;
    this.update(descriptor.view.text, labels);
  }

  describe(descriptor: InlineRegionDescriptor): void {
    this.id = descriptor.id;
    this.rule = descriptor.rule;
    this.span = descriptor.span;
    this.view = descriptor.view;
  }
}

interface SyntaxBlockDescriptor {
  id: number;
  node: SyntaxTreeNode;
  offset: number;
  regionIds: readonly number[];
  regionRevisions: readonly number[];
  source: string;
  syntax: MarkdownSyntax;
  version: number;
}

type CollectedBlock = Omit<SyntaxBlockDescriptor, "regionRevisions" | "syntax" | "version">;

function rangesOf(tree: SyntaxTree, node: SyntaxTreeNode): SourceRange[] {
  return tree.children(node).flatMap((child) => {
    if (child.kind === "node" || tree.leafTokenType(child) !== "InlineChunk") {
      return [];
    }
    const token = tree.leafToken(child);
    return token.ranges?.length ? [...token.ranges] : [{ offset: token.offset, end: token.offset + token.text.length }];
  });
}

function createInlineRegion(descriptor: InlineRegionDescriptor, labels: ReadonlySet<string>): InlineRegion {
  return new InlineRegion(descriptor, labels);
}

function updateInlineRegion(
  region: InlineRegion,
  descriptor: InlineRegionDescriptor,
  labels: ReadonlySet<string>,
  edits: readonly TextEdit[] | null,
): InlineRegion {
  const document = region.document;
  const sourceEdits = edits && region.view.text !== descriptor.view.text
    ? projectSourceEdits(region.view, descriptor.view, edits)
    : null;
  const changed = region.update(descriptor.view.text, labels, document?.edit, sourceEdits);
  region.describe(descriptor);
  if (!changed) {
    return region;
  }
  if (!document) {
    region.document = inlineParser.createDocument(descriptor.view.text, region.tokens, "InlineLines");
  }
  region.revision++;
  return region;
}

function sameNumbers(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

class MarkdownSyntaxImpl implements MarkdownSyntax {
  #blocks: readonly SyntaxBlockDescriptor[] = [];
  #inlineTrees = new WeakMap<SyntaxTree, InlineRegion>();
  #regions = new Map<number, InlineRegion>();
  #source: string;
  #tree: SyntaxTree;

  constructor(tree: SyntaxTree, source: string) {
    this.#tree = tree;
    this.#source = source;
    this.update(tree, source);
  }

  blocks(): readonly SyntaxBlockDescriptor[] {
    return this.#blocks;
  }

  update(tree: SyntaxTree, source: string, edits: readonly TextEdit[] = []): void {
    this.#inlineTrees = new WeakMap();
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
        ? updateInlineRegion(previous, descriptor, labels, edits)
        : createInlineRegion(descriptor, labels);
      regions.set(descriptor.id, region);
    }
    const previousBlocks = new Map(this.#blocks.map((block) => [block.id, block]));
    const nextBlocks = blocks.map((block): SyntaxBlockDescriptor => {
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

export function createMarkdownSyntax(tree: SyntaxTree, source: string): MarkdownSyntaxImpl {
  return new MarkdownSyntaxImpl(tree, source);
}
