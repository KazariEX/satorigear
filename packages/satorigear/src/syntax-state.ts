import { InlineRegion, type InlineRegionBinding } from "./inline/region.ts";
import {
  inlineSyntaxArena,
  parseInline,
  parseInlineForest,
} from "./inline/syntax.ts";
import { inlineTokenCount, inlineTokenStart, type InlineTokenStream } from "./inline/tokens.ts";
import {
  createSourceView,
  type SourceSpan,
  type SourceView,
  type TextEdit,
} from "./source-view.ts";
import type { BlockSyntaxView } from "./block/syntax.ts";
import type { BlockToken } from "./block/tokens.ts";
import type { SyntaxProfile } from "./profile/types.ts";
import type { SyntaxArena } from "./syntax-protocol.ts";

export interface SyntaxBlock {
  id: number;
  offset: number;
  regionIds: readonly number[];
  regionRevisions: readonly number[];
  source: string;
  tokenBase: number;
  version: number;
}

export interface MarkdownInlineSyntax {
  arena: SyntaxArena;
  blockRule: string;
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

export interface SyntaxState {
  blocks: () => readonly SyntaxBlock[];
  blockView: () => BlockSyntaxView;
  inlineForBlock: (nodeId: number) => MarkdownInlineSyntax | undefined;
  openInlineForest: (blocks: readonly SyntaxBlock[]) => InlineForestLease;
  update: (source: string, view: BlockSyntaxView, edits?: readonly TextEdit[]) => void;
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

class SyntaxStateImpl implements SyntaxState {
  #blocks: readonly SyntaxBlock[] = [];
  // Root IDs point into generated scratch storage and exist only while an inline forest lease is open.
  #forestRoots = new Map<number, InlineForestRoot>();
  #profile: SyntaxProfile;
  #regions = new Map<number, InlineRegion>();
  #view: BlockSyntaxView;

  constructor(source: string, view: BlockSyntaxView, profile: SyntaxProfile) {
    this.#profile = profile;
    this.#view = view;
    this.update(source, view);
  }

  blocks(): readonly SyntaxBlock[] {
    return this.#blocks;
  }

  update(source: string, view: BlockSyntaxView, edits: readonly TextEdit[] = []): void {
    const arena = view.arena;
    const definitions = new Set<string>();
    const bindings: InlineRegionBinding[] = [];
    const stableRegionIds = new Set<number>();
    const blocks: SyntaxBlock[] = [];
    const collect = (
      nodeId: number,
      offset: number,
      tokenBase: number,
      regionIds: number[],
    ): void => {
      const rule = arena.ruleNameOf(nodeId);
      const definitionKey = this.#profile.blockDefinitionKeys[rule];
      if (definitionKey) {
        definitions.add(definitionKey(view.tokenAt(tokenBase)));
      }
      if (this.#profile.blockInlineContents[rule]) {
        const spans = inlineSpansOf(view, arena, nodeId, tokenBase);
        if (spans.length > 0) {
          bindings.push({
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

    // Inline resolution starts after the full definition map is known; later definitions affect earlier uses.
    const regions = new Map<number, InlineRegion>();
    const available: InlineRegion[] = [];
    for (const region of this.#regions.values()) {
      if (!stableRegionIds.has(region.id)) {
        available.push(region);
      }
    }
    for (const binding of bindings) {
      let previous = this.#regions.get(binding.id);
      if (!previous) {
        // Rebind displaced state by rule and proximity when arena surgery changes node identities.
        let nearest = -1;
        let distance = Number.POSITIVE_INFINITY;
        for (let index = 0; index < available.length; index++) {
          const candidate = available[index];
          const candidateDistance = candidate.rule === binding.rule
            ? Math.abs(candidate.span.start - binding.span.start)
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
        ? previous.update(binding, definitions, edits)
        : new InlineRegion(this.#profile.resolveInline, binding, definitions);
      regions.set(binding.id, region);
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
      const unchanged = (
        previous?.source === block.source &&
        sameNumbers(previous.regionIds, block.regionIds) &&
        sameNumbers(previous.regionRevisions, regionRevisions)
      );
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
    // A leased block stays entirely on scratch; one region-owned syntax arena would switch arenas mid-projection.
    for (const block of blocks) {
      const start = regions.length;
      for (const id of block.regionIds) {
        const region = this.#regions.get(id);
        if (!region || region.syntax) {
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
    // Region syntax documents own their arena; forest and one-shot roots borrow shared scratch synchronously.
    const regionSyntax = region.syntax;
    const forestRoot = this.#forestRoots.get(nodeId);
    return {
      arena: regionSyntax?.arena ?? inlineSyntaxArena,
      blockRule: region.rule,
      rootId: regionSyntax?.rootId ?? forestRoot?.id ?? parseInline(
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

export function createSyntaxState(source: string, view: BlockSyntaxView, profile: SyntaxProfile): SyntaxState {
  return new SyntaxStateImpl(source, view, profile);
}
