import { InlineRegion, type InlineRegionBinding } from "./inline/region.ts";
import { inlineTokenCount, inlineTokenStart, type InlineTokenStream } from "./inline/tokens.ts";
import {
  createSourceView,
  type SourceSpan,
  type SourceView,
} from "./source-view.ts";
import type { BlockSyntaxView } from "./block/syntax.ts";
import type { BlockToken } from "./block/tokens.ts";
import type { InlineSyntaxArena } from "./inline/syntax.ts";
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

interface InlineRoot {
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

export class SyntaxState {
  #blocks: readonly SyntaxBlock[] = [];
  #inlineArena: InlineSyntaxArena;
  #inlineRoots = new Map<number, InlineRoot>();
  #profile: SyntaxProfile;
  #regions = new Map<number, InlineRegion>();
  #view: BlockSyntaxView;

  constructor(
    source: string,
    view: BlockSyntaxView,
    profile: SyntaxProfile,
    inlineArena: InlineSyntaxArena,
  ) {
    this.#inlineArena = inlineArena;
    this.#profile = profile;
    this.#view = view;
    this.update(source, view);
  }

  blocks(): readonly SyntaxBlock[] {
    return this.#blocks;
  }

  update(source: string, view: BlockSyntaxView): void {
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
        ? previous.update(binding, definitions)
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

  prepareInline(blocks: readonly SyntaxBlock[]): void {
    const regionIds: number[] = [];
    const segments: InlineTokenStream[] = [];
    for (const block of blocks) {
      for (const id of block.regionIds) {
        const region = this.#regions.get(id);
        if (!region) {
          throw new Error(`Block references missing inline region ${id}`);
        }
        regionIds.push(id);
        segments.push(region.tokens);
      }
    }

    const roots: number[] = [];
    this.#inlineArena.build(segments, roots);
    this.#inlineRoots.clear();
    let tokenBase = 0;
    for (let index = 0; index < regionIds.length; index++) {
      this.#inlineRoots.set(regionIds[index], { id: roots[index], tokenBase });
      tokenBase += inlineTokenCount(segments[index]);
    }
  }

  inlineForBlock(nodeId: number): MarkdownInlineSyntax | undefined {
    const region = this.#regions.get(nodeId);
    if (!region) {
      return;
    }
    const root = this.#inlineRoots.get(nodeId);
    if (!root) {
      throw new Error(`Inline region ${nodeId} was projected outside its prepared block batch`);
    }
    return {
      arena: this.#inlineArena,
      blockRule: region.rule,
      rootId: root.id,
      rootOffset: inlineTokenCount(region.tokens) > 0 ? inlineTokenStart(region.tokens, 0) : 0,
      rootTokenBase: root.tokenBase,
      tokens: region.tokens,
      view: region.view,
    };
  }
}
