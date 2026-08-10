import {
  createInlineSyntaxDocument,
  inlineSyntaxArena,
  type InlineSyntaxDocument,
  inlineTokenCount,
  inlineTokenStart,
  type InlineTokenStream,
  parseInline,
  parseInlineForest,
} from "./inline/runtime.ts";
import { InlineTokenState } from "./inline/tokenizer.ts";
import {
  createSourceView,
  projectSourceEdits,
  type SourceSpan,
  type SourceView,
  type TextEdit,
} from "./source-view.ts";
import type { BlockSyntaxView } from "./block/runtime.ts";
import type { BlockToken } from "./block/tokens.ts";
import type { SyntaxProfile } from "./profile/types.ts";
import type { SyntaxArena } from "./syntax-protocol.ts";

export interface MarkdownInlineSyntax {
  arena: SyntaxArena;
  rootId: number;
  rootOffset: number;
  rootTokenBase: number;
  tokens: InlineTokenStream;
  view: SourceView;
}

export interface InlineForestLease {
  blocks: readonly SyntaxBlock[];
  close: () => void;
}

export interface MarkdownSyntax {
  blocks: () => readonly SyntaxBlock[];
  blockView: () => BlockSyntaxView;
  inlineForBlock: (nodeId: number) => MarkdownInlineSyntax | undefined;
  openInlineForest: (blocks: readonly SyntaxBlock[]) => InlineForestLease;
  update: (view: BlockSyntaxView, source: string, edits?: readonly TextEdit[]) => void;
}

interface InlineRegionDescriptor {
  id: number;
  rule: string;
  span: { end: number; start: number };
  view: SourceView;
}

class InlineRegion extends InlineTokenState {
  document?: InlineSyntaxDocument;
  id: number;
  revision = 0;
  rule: string;
  span: { end: number; start: number };
  view: SourceView;

  get source(): string {
    return this.view.text;
  }

  constructor(profile: SyntaxProfile, descriptor: InlineRegionDescriptor, labels: ReadonlySet<string>) {
    super(profile);
    this.id = descriptor.id;
    this.rule = descriptor.rule;
    this.span = descriptor.span;
    this.view = descriptor.view;
    this.updateTokens(descriptor.view.text, labels);
  }

  #rebind(descriptor: InlineRegionDescriptor): void {
    this.id = descriptor.id;
    this.rule = descriptor.rule;
    this.span = descriptor.span;
    this.view = descriptor.view;
  }

  update(
    descriptor: InlineRegionDescriptor,
    labels: ReadonlySet<string>,
    edits: readonly TextEdit[] | null,
  ): this {
    const document = this.document;
    const sourceEdits = edits && this.view.text !== descriptor.view.text
      ? projectSourceEdits(this.view, descriptor.view, edits)
      : null;
    const changed = this.updateTokens(descriptor.view.text, labels, document?.edit, sourceEdits);
    this.#rebind(descriptor);
    if (!changed) {
      return this;
    }
    if (!document) {
      this.document = createInlineSyntaxDocument(descriptor.view.text, this.tokens);
    }
    this.revision++;
    return this;
  }
}

export interface SyntaxBlock {
  id: number;
  offset: number;
  regionIds: readonly number[];
  regionRevisions: readonly number[];
  source: string;
  tokenBase: number;
  version: number;
}

interface InlineForestRoot {
  id: number;
  tokenBase: number;
}

function appendTokenSpans(spans: SourceSpan[], token: BlockToken): void {
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
  view: BlockSyntaxView,
  arena: SyntaxArena,
  nodeId: number,
  tokenBase: number,
): SourceSpan[] {
  const spans: SourceSpan[] = [];
  const childCount = arena.childCount(nodeId);
  for (let index = 0; index < childCount; index++) {
    const entry = arena.childAt(nodeId, index);
    if (entry < 0) {
      const token = view.tokenAt(arena.leafToken(entry, tokenBase));
      if (token.type === "InlineChunk") {
        appendTokenSpans(spans, token);
      }
    }
  }
  return spans;
}

function sameNumbers(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

class MarkdownSyntaxImpl implements MarkdownSyntax {
  #blocks: readonly SyntaxBlock[] = [];
  // Root IDs point into generated scratch storage and exist only while an inline forest lease is open.
  #forestRoots = new Map<number, InlineForestRoot>();
  #profile: SyntaxProfile;
  #regions = new Map<number, InlineRegion>();
  #view: BlockSyntaxView;

  constructor(profile: SyntaxProfile, view: BlockSyntaxView, source: string) {
    this.#profile = profile;
    this.#view = view;
    this.update(view, source);
  }

  blocks(): readonly SyntaxBlock[] {
    return this.#blocks;
  }

  update(view: BlockSyntaxView, source: string, edits: readonly TextEdit[] = []): void {
    const arena = view.arena;
    const labels = new Set<string>();
    const descriptors: InlineRegionDescriptor[] = [];
    const stableRegionIds = new Set<number>();
    const blocks: SyntaxBlock[] = [];
    const collect = (
      nodeId: number,
      offset: number,
      tokenBase: number,
      regionIds: number[],
    ): void => {
      const rule = arena.ruleNameOf(nodeId);
      const referenceLabel = this.#profile.blockReferenceLabels[rule];
      if (referenceLabel) {
        labels.add(referenceLabel(view.tokenAt(tokenBase)));
        return;
      }
      if (this.#profile.blockInlineContents[rule]) {
        const spans = inlineSpansOf(view, arena, nodeId, tokenBase);
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
    const root = view.root;
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
      // Allocate each block record once; region revisions are filled after all regions resolve.
      blocks.push({
        id: childId,
        offset,
        regionIds,
        regionRevisions: [],
        source: source.slice(offset, offset + arena.lenOf(childId)),
        tokenBase,
        version: 0,
      });
    }

    // Inline resolution starts after the full reference map is known; later definitions affect earlier uses.
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
        // Rebind displaced state by rule and proximity when arena surgery changes node identities.
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
        ? previous.update(descriptor, labels, edits)
        : new InlineRegion(this.#profile, descriptor, labels);
      regions.set(descriptor.id, region);
    }
    const previousBlocks = new Map(this.#blocks.map((block) => [block.id, block]));
    for (const block of blocks) {
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
      block.regionRevisions = regionRevisions;
      block.version = unchanged ? previous.version : (previous?.version ?? -1) + 1;
    }
    this.#view = view;
    this.#blocks = blocks;
    this.#regions = regions;
  }

  blockView(): BlockSyntaxView {
    return this.#view;
  }

  openInlineForest(blocks: readonly SyntaxBlock[]): InlineForestLease {
    const regions: InlineRegion[] = [];
    const forestBlocks: SyntaxBlock[] = [];
    // A leased block must stay entirely on the scratch arena; one private region would switch arenas mid-projection.
    for (const block of blocks) {
      const start = regions.length;
      for (const id of block.regionIds) {
        const region = this.#regions.get(id);
        if (!region || region.document) {
          regions.length = start;
          break;
        }
        regions.push(region);
      }
      if (regions.length > start) {
        forestBlocks.push(block);
      }
    }
    this.#forestRoots.clear();
    try {
      if (regions.length < 2) {
        forestBlocks.length = 0;
      }
      else {
        const arena = inlineSyntaxArena;
        const rootId = parseInlineForest(regions);
        const childCount = arena.childCount(rootId);
        let regionIndex = 0;
        for (let index = 0; index < childCount; index++) {
          const childId = arena.childAt(rootId, index);
          if (childId >= 0 && arena.ruleNameOf(childId) === "InlineLines") {
            this.#forestRoots.set(regions[regionIndex++].id, {
              id: childId,
              tokenBase: arena.childTokRelAt(rootId, index),
            });
          }
        }
        if (regionIndex !== regions.length) {
          throw new Error("Inline forest did not preserve its region boundaries");
        }
      }
      return { blocks: forestBlocks, close: () => this.#forestRoots.clear() };
    }
    catch (error) {
      this.#forestRoots.clear();
      throw error;
    }
  }

  inlineForBlock(nodeId: number): MarkdownInlineSyntax | undefined {
    const region = this.#regions.get(nodeId);
    if (!region) {
      return;
    }
    // Document views own their arena; forest and one-shot roots borrow the generated scratch arena synchronously.
    const document = region.document;
    const forestRoot = this.#forestRoots.get(nodeId);
    return {
      arena: document?.arena ?? inlineSyntaxArena,
      rootId: document?.rootId ?? forestRoot?.id ?? parseInline(
        region.view.text,
        region.tokens,
      ),
      rootOffset: inlineTokenCount(region.tokens) > 0 ? inlineTokenStart(region.tokens, 0) : 0,
      rootTokenBase: forestRoot?.tokenBase ?? 0,
      tokens: region.tokens,
      view: region.view,
    };
  }
}

export function createMarkdownSyntax(profile: SyntaxProfile, view: BlockSyntaxView, source: string): MarkdownSyntax {
  return new MarkdownSyntaxImpl(profile, view, source);
}
