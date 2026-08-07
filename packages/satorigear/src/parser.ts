import type { Token } from "monogram/gen-lexer.ts";
import {
  createEmittedParser,
  type EmittedArena,
  type EmittedParserDocument,
  type SyntaxTree,
} from "./emitted-parser.ts";
import * as blockRuntime from "./generated/blocks.ts";
import * as inlineRuntime from "./generated/inline.ts";
import { tokenizeMarkdownBlocks } from "./grammar-blocks.ts";
import { normalizeMarkdownReferenceLabel } from "./grammar-inline.ts";
import { InlineTokenState } from "./inline-tokenizer.ts";
import {
  createSourceView,
  projectSourceEdits,
  type SourceSpan,
  type SourceView,
} from "./source-view.ts";
import type {
  MarkdownInlineSyntax,
  MarkdownSyntax,
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
  offset: number;
  regionIds: readonly number[];
  regionRevisions: readonly number[];
  source: string;
  syntax: MarkdownSyntax;
  tokenBase: number;
  version: number;
}

type CollectedBlock = Omit<SyntaxBlockDescriptor, "regionRevisions" | "syntax" | "version">;

function appendTokenSpans(spans: SourceSpan[], token: Token): void {
  if (token.ranges?.length) {
    for (const range of token.ranges) {
      spans.push({ start: range.offset, end: range.end });
    }
  }
  else {
    spans.push({ start: token.offset, end: token.offset + token.text.length });
  }
}

function inlineSpansOf(
  tree: SyntaxTree,
  arena: EmittedArena,
  nodeId: number,
  tokenBase: number,
): SourceSpan[] {
  const spans: SourceSpan[] = [];
  const childCount = arena.childCount(nodeId);
  for (let index = 0; index < childCount; index++) {
    const entry = arena.childAt(nodeId, index);
    if (entry < 0) {
      const token = tree.tokenAt(arena.leafToken(entry, tokenBase));
      if (token.type === "InlineChunk") {
        appendTokenSpans(spans, token);
      }
    }
  }
  return spans;
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
  #regions = new Map<number, InlineRegion>();
  #tree: SyntaxTree;

  constructor(tree: SyntaxTree, source: string) {
    this.#tree = tree;
    this.update(tree, source);
  }

  blocks(): readonly SyntaxBlockDescriptor[] {
    return this.#blocks;
  }

  update(tree: SyntaxTree, source: string, edits: readonly TextEdit[] = []): void {
    const arena = tree.arena;
    const labels = new Set<string>();
    const descriptors: InlineRegionDescriptor[] = [];
    const stableRegionIds = new Set<number>();
    const blocks: CollectedBlock[] = [];
    const collect = (
      nodeId: number,
      offset: number,
      tokenBase: number,
      regionIds: number[],
    ): void => {
      const rule = arena.ruleNameOf(nodeId);
      if (rule === "LinkDefinition") {
        const label = referenceLabelText(source.slice(offset, offset + arena.lenOf(nodeId)));
        if (label) {
          labels.add(label);
        }
        return;
      }
      if (rule === "Paragraph" || rule === "AtxHeading" || rule === "SetextHeading") {
        const spans = inlineSpansOf(tree, arena, nodeId, tokenBase);
        if (spans.length > 0) {
          descriptors.push({
            id: nodeId,
            rule,
            span: { start: offset, end: offset + arena.lenOf(nodeId) },
            view: createSourceView(source, spans),
          });
          stableRegionIds.add(nodeId);
          regionIds.push(nodeId);
        }
        return;
      }
      const childCount = arena.childCount(nodeId);
      for (let index = 0; index < childCount; index++) {
        const child = arena.childAt(nodeId, index);
        if (child >= 0) {
          collect(
            child,
            offset + arena.childRelAt(nodeId, index),
            tokenBase + arena.childTokRelAt(nodeId, index),
            regionIds,
          );
        }
      }
    };
    const root = tree.root;
    const rootChildCount = arena.childCount(root.id);
    for (let index = 0; index < rootChildCount; index++) {
      const childId = arena.childAt(root.id, index);
      if (childId < 0 || arena.ruleNameOf(childId) !== "Block") {
        continue;
      }
      const offset = root.offset + arena.childRelAt(root.id, index);
      const tokenBase = root.tokenBase + arena.childTokRelAt(root.id, index);
      const regionIds: number[] = [];
      collect(childId, offset, tokenBase, regionIds);
      blocks.push({
        id: childId,
        offset,
        regionIds,
        source: source.slice(offset, offset + arena.lenOf(childId)),
        tokenBase,
      });
    }

    const regions = new Map<number, InlineRegion>();
    const available: InlineRegion[] = [];
    for (const region of this.#regions.values()) {
      if (!stableRegionIds.has(region.id)) {
        available.push(region);
      }
    }
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
    this.#blocks = nextBlocks;
    this.#regions = regions;
  }

  blockTree(): SyntaxTree {
    return this.#tree;
  }

  inlineForBlock(nodeId: number): MarkdownInlineSyntax | undefined {
    const region = this.#regions.get(nodeId);
    if (!region) {
      return;
    }
    const tree = region.document
      ? region.document.tree(region.tokens)
      : inlineParser.parseTree(region.view.text, region.tokens, "InlineLines");
    return {
      arena: tree.arena,
      rootId: tree.root.id,
      rootOffset: tree.root.offset,
      rootTokenBase: tree.root.tokenBase,
      tokenAt: tree.tokenAt,
      view: region.view,
    };
  }
}

export function createMarkdownSyntax(tree: SyntaxTree, source: string): MarkdownSyntaxImpl {
  return new MarkdownSyntaxImpl(tree, source);
}
