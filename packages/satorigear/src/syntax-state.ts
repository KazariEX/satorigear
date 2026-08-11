import { InlineRegion, type InlineRegionBinding } from "./inline/region.ts";
import { inlineTokenCount, inlineTokenStart, type InlineTokenStream } from "./inline/tokens.ts";
import { emptySet, isArrayEqual, isSetEqual } from "./primitives.ts";
import {
  createSourceView,
  type SourceSpan,
  type SourceView,
} from "./source-view.ts";
import type { BlockSyntaxView } from "./block/arena.ts";
import type { BlockToken } from "./block/tokens.ts";
import type { InlineArena } from "./inline/arena.ts";
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

interface BlockDefinition {
  blockIndex: number;
  key: string;
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

export class SyntaxState {
  #blocks: SyntaxBlock[] = [];
  #definitionEntries?: BlockDefinition[];
  #definitions: ReadonlySet<string> = emptySet;
  #inlineArena: InlineArena;
  #inlineRoots = new Map<number, InlineRoot>();
  #profile: SyntaxProfile;
  #regions = new Map<number, InlineRegion>();
  #view: BlockSyntaxView;

  constructor(
    source: string,
    view: BlockSyntaxView,
    profile: SyntaxProfile,
    inlineArena: InlineArena,
  ) {
    this.#inlineArena = inlineArena;
    this.#profile = profile;
    this.#view = view;
    this.update(source, view);
  }

  blocks(): readonly SyntaxBlock[] {
    return this.#blocks;
  }

  update(source: string, view: BlockSyntaxView, stablePrefixEnd = 0): void {
    const arena = view.arena;
    const previousBlocks = this.#blocks;
    const initializing = previousBlocks.length === 0;
    // The scanner restart is a semantic boundary; blocks before it retain source and arena identity.
    let prefixLength = 0;
    while (
      prefixLength < previousBlocks.length &&
      previousBlocks[prefixLength].offset < stablePrefixEnd
    ) {
      prefixLength++;
    }
    const blocks: SyntaxBlock[] = prefixLength === 0 ? [] : previousBlocks.slice(0, prefixLength);
    const previousDefinitionEntries = this.#definitionEntries;
    let stableDefinitionCount = 0;
    const definitions = new Set<string>();
    // Sparse ownership records restore global definitions without revisiting stable block subtrees.
    if (previousDefinitionEntries) {
      while (
        stableDefinitionCount < previousDefinitionEntries.length &&
        previousDefinitionEntries[stableDefinitionCount].blockIndex < prefixLength
      ) {
        stableDefinitionCount++;
      }
      for (let index = 0; index < stableDefinitionCount; index++) {
        definitions.add(previousDefinitionEntries[index].key);
      }
    }

    const bindings: InlineRegionBinding[] = [];
    const stableRegionIds = new Set<number>();
    let tailDefinitionEntries: BlockDefinition[] | undefined;
    const collect = (
      nodeId: number,
      offset: number,
      tokenBase: number,
      blockIndex: number,
      regionIds: number[],
    ): void => {
      const rule = arena.ruleNameOf(nodeId);
      const definitionKey = this.#profile.block.definitionKeys[rule];
      if (definitionKey) {
        const key = definitionKey(view.tokenAt(tokenBase));
        (tailDefinitionEntries ??= []).push({ blockIndex, key });
        definitions.add(key);
      }
      if (this.#profile.block.inlineContents[rule]) {
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
            blockIndex,
            regionIds,
          );
        }
      }
    };
    const root = view.root;
    const rootChildCount = arena.childCount(root.id);
    for (let index = prefixLength; index < rootChildCount; index++) {
      const childId = arena.childAt(root.id, index);
      if (childId < 0 || arena.ruleNameOf(childId) !== "Block") {
        continue;
      }
      const offset = root.offset + arena.childRelAt(root.id, index);
      const tokenBase = root.tokenBase + arena.childTokRelAt(root.id, index);
      const regionIds: number[] = [];
      collect(childId, offset, tokenBase, blocks.length, regionIds);
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
    const definitionsChanged = prefixLength > 0 && !isSetEqual(this.#definitions, definitions);
    if (definitionsChanged) {
      for (let index = 0; index < prefixLength; index++) {
        const block = blocks[index];
        const revisions = new Array<number>(block.regionIds.length);
        for (let regionIndex = 0; regionIndex < block.regionIds.length; regionIndex++) {
          const id = block.regionIds[regionIndex];
          const region = this.#regions.get(id);
          if (!region) {
            throw new Error(`Stable block references missing inline region ${id}`);
          }
          region.updateDefinitions(definitions);
          revisions[regionIndex] = region.revision;
        }
        if (!isArrayEqual(block.regionRevisions, revisions)) {
          block.regionRevisions = revisions;
          block.version++;
        }
      }
    }

    let oldTailRegionIds: Set<number> | undefined;
    const available: InlineRegion[] = [];
    // Tail arena IDs may be reassigned; unmatched old regions remain candidates for proximity rebinding.
    if (prefixLength > 0) {
      oldTailRegionIds = new Set<number>();
      for (let index = prefixLength; index < previousBlocks.length; index++) {
        for (const id of previousBlocks[index].regionIds) {
          if (oldTailRegionIds.has(id)) {
            continue;
          }
          oldTailRegionIds.add(id);
          const region = this.#regions.get(id);
          if (!region) {
            throw new Error(`Replaced block references missing inline region ${id}`);
          }
          if (!stableRegionIds.has(id)) {
            available.push(region);
          }
        }
      }
    }
    else if (!initializing) {
      for (const region of this.#regions.values()) {
        if (!stableRegionIds.has(region.id)) {
          available.push(region);
        }
      }
    }

    const tailRegions = new Map<number, InlineRegion>();
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
        : new InlineRegion(this.#profile.inline, binding, definitions);
      tailRegions.set(binding.id, region);
    }

    let previousTailBlocks: Map<number, SyntaxBlock> | undefined;
    if (!initializing) {
      previousTailBlocks = new Map<number, SyntaxBlock>();
      for (let index = prefixLength; index < previousBlocks.length; index++) {
        previousTailBlocks.set(previousBlocks[index].id, previousBlocks[index]);
      }
    }
    for (let index = prefixLength; index < blocks.length; index++) {
      const block = blocks[index];
      const previous = previousTailBlocks?.get(block.id);
      const regionRevisions = block.regionIds.map((id) => {
        const region = tailRegions.get(id);
        if (!region) {
          throw new Error(`Block references missing inline region ${id}`);
        }
        return region.revision;
      });
      const unchanged = (
        previous?.source === block.source &&
        isArrayEqual(previous.regionIds, block.regionIds) &&
        isArrayEqual(previous.regionRevisions, regionRevisions)
      );
      block.regionRevisions = regionRevisions;
      block.version = unchanged ? previous.version : (previous?.version ?? -1) + 1;
    }

    if (prefixLength === 0) {
      this.#regions = tailRegions;
    }
    else if (oldTailRegionIds) {
      // Commit the rebuilt tail while leaving stable prefix regions in the existing map.
      for (const id of oldTailRegionIds) {
        this.#regions.delete(id);
      }
      for (const [id, region] of tailRegions) {
        this.#regions.set(id, region);
      }
    }
    this.#view = view;
    this.#blocks = blocks;
    if (stableDefinitionCount === 0) {
      this.#definitionEntries = tailDefinitionEntries;
    }
    else if (previousDefinitionEntries) {
      previousDefinitionEntries.length = stableDefinitionCount;
      if (tailDefinitionEntries) {
        for (const entry of tailDefinitionEntries) {
          previousDefinitionEntries.push(entry);
        }
      }
    }
    this.#definitions = definitions;
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
