import { InlineRegion, type InlineRegionBinding } from "./inline/region.ts";
import { inlineTokenCount, inlineTokenStart, type InlineTokenStream } from "./inline/tokens.ts";
import { emptyArray, emptySet, isArrayEqual, isSetEqual } from "./primitives.ts";
import { createSourceView, type SourceSpan, type SourceView } from "./source-view.ts";
import type { BlockArenaChange, BlockHandle, BlockSyntaxView } from "./block/arena.ts";
import type { BlockToken } from "./block/tokens.ts";
import type { InlineArena } from "./inline/arena.ts";
import type { SyntaxProfile } from "./profile/types.ts";
import type { SyntaxArena } from "./syntax-protocol.ts";

export interface SyntaxBlock {
  handle: BlockHandle;
  offset: number;
  regions: readonly InlineRegion[];
  regionRevisions: readonly number[];
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
  // Blocks own region lifetimes; this index only resolves current arena node IDs during projection.
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

  update(
    source: string,
    view: BlockSyntaxView,
    change?: BlockArenaChange,
    stableBlockCount = 0,
  ): void {
    const arena = view.arena;
    const previousBlocks = this.#blocks;
    const oldStart = change?.oldStart ?? 0;
    const oldEnd = change?.oldEnd ?? 0;
    const newEnd = change?.newEnd ?? view.blockHandles.length;
    const blocks: SyntaxBlock[] = stableBlockCount === 0 ? [] : previousBlocks.slice(0, stableBlockCount);
    const previousDefinitionEntries = this.#definitionEntries;
    let stableDefinitionCount = 0;
    const availableDefinitions = new Set<string>();
    if (previousDefinitionEntries) {
      while (
        stableDefinitionCount < previousDefinitionEntries.length &&
        previousDefinitionEntries[stableDefinitionCount].blockIndex < stableBlockCount
      ) {
        stableDefinitionCount++;
      }
      for (let index = 0; index < stableDefinitionCount; index++) {
        availableDefinitions.add(previousDefinitionEntries[index].key);
      }
    }

    const bindings: InlineRegionBinding[] = [];
    let tailDefinitionEntries: BlockDefinition[] | undefined;
    const collect = (
      nodeId: number,
      offset: number,
      tokenBase: number,
      blockIndex: number,
    ): void => {
      const rule = arena.ruleNameOf(nodeId);
      const definitionKey = this.#profile.block.definitionKeys[rule];
      if (definitionKey) {
        const key = definitionKey(view.tokenAt(tokenBase));
        (tailDefinitionEntries ??= []).push({ blockIndex, key });
        availableDefinitions.add(key);
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
          );
        }
      }
    };
    // Inline resolution needs the complete definition set, so one flat list records block boundaries
    // without allocating temporary binding arrays for every block.
    const bindingStarts: number[] = [];
    const root = view.root;
    const rootChildCount = arena.childCount(root.id);
    for (let index = stableBlockCount; index < rootChildCount; index++) {
      const childId = arena.childAt(root.id, index);
      if (childId < 0 || !view.arena.isBlock(childId)) {
        continue;
      }
      const offset = root.offset + arena.childRelAt(root.id, index);
      const tokenBase = root.tokenBase + arena.childTokRelAt(root.id, index);
      bindingStarts.push(bindings.length);
      collect(childId, offset, tokenBase, blocks.length);
      blocks.push({
        handle: view.blockHandles[index],
        offset,
        regions: emptyArray,
        regionRevisions: emptyArray,
        tokenBase,
        version: 0,
      });
    }

    // Inline resolution starts after the full definition map is known; later definitions affect earlier uses.
    const definitionsChanged = stableBlockCount > 0 && !isSetEqual(this.#definitions, availableDefinitions);
    if (definitionsChanged) {
      for (let index = 0; index < stableBlockCount; index++) {
        const block = blocks[index];
        const revisions = new Array<number>(block.regions.length);
        for (let regionIndex = 0; regionIndex < block.regions.length; regionIndex++) {
          const region = block.regions[regionIndex];
          region.updateDefinitions(availableDefinitions);
          revisions[regionIndex] = region.revision;
        }
        if (!isArrayEqual(block.regionRevisions, revisions)) {
          block.regionRevisions = revisions;
          block.version++;
        }
      }
    }

    // Reused regions may acquire new arena IDs, so remove the old tail index before rebinding.
    for (let index = stableBlockCount; index < previousBlocks.length; index++) {
      for (const region of previousBlocks[index].regions) {
        if (this.#regions.get(region.id) === region) {
          this.#regions.delete(region.id);
        }
      }
    }
    const displacedRegions: InlineRegion[] = [];
    for (let index = oldStart; index < oldEnd; index++) {
      for (const region of previousBlocks[index].regions) {
        displacedRegions.push(region);
      }
    }

    for (let blockIndex = stableBlockCount; blockIndex < blocks.length; blockIndex++) {
      const block = blocks[blockIndex];
      let previous: SyntaxBlock | undefined;
      if (blockIndex < oldStart) {
        previous = previousBlocks[blockIndex];
      }
      else if (blockIndex >= newEnd) {
        previous = previousBlocks[oldEnd + blockIndex - newEnd];
      }
      const bindingStart = bindingStarts[blockIndex - stableBlockCount];
      const bindingEnd = bindingStarts[blockIndex - stableBlockCount + 1] ?? bindings.length;
      const regions = new Array<InlineRegion>(bindingEnd - bindingStart);
      for (let bindingIndex = bindingStart; bindingIndex < bindingEnd; bindingIndex++) {
        const binding = bindings[bindingIndex];
        const regionIndex = bindingIndex - bindingStart;
        let candidate = previous?.regions[regionIndex];
        if (!candidate) {
          let nearest = displacedRegions.findIndex((value) => value.id === binding.id);
          // Changed blocks retain lexer state by matching their displaced inline regions in source order.
          if (nearest < 0) {
            let distance = Number.POSITIVE_INFINITY;
            for (let index = 0; index < displacedRegions.length; index++) {
              const value = displacedRegions[index];
              const candidateDistance = value.rule === binding.rule
                ? Math.abs(value.span.start - binding.span.start)
                : Number.POSITIVE_INFINITY;
              if (candidateDistance < distance) {
                distance = candidateDistance;
                nearest = index;
              }
            }
          }
          candidate = nearest < 0 ? void 0 : displacedRegions.splice(nearest, 1)[0];
        }
        regions[regionIndex] = candidate
          ? candidate.update(binding, availableDefinitions)
          : new InlineRegion(this.#profile.inline, binding, availableDefinitions);
      }

      const regionRevisions = regions.map((region) => region.revision);
      // Arena prefix handles may survive token-equivalent edits with different source geometry.
      // Only the converged suffix is projection-stable without comparing duplicate block text.
      const projectionStable = (
        blockIndex >= newEnd &&
        previous !== void 0 &&
        isArrayEqual(previous.regionRevisions, regionRevisions)
      );
      block.regions = regions;
      block.regionRevisions = regionRevisions;
      block.version = previous === void 0
        ? 0
        : projectionStable ? previous.version : previous.version + 1;
    }

    for (let index = stableBlockCount; index < blocks.length; index++) {
      for (const region of blocks[index].regions) {
        this.#regions.set(region.id, region);
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
    this.#definitions = availableDefinitions;
  }

  blockView(): BlockSyntaxView {
    return this.#view;
  }

  prepareInline(blocks: readonly SyntaxBlock[]): void {
    const regions: InlineRegion[] = [];
    const segments: InlineTokenStream[] = [];
    for (const block of blocks) {
      for (const region of block.regions) {
        regions.push(region);
        segments.push(region.tokens);
      }
    }

    const roots: number[] = [];
    this.#inlineArena.build(segments, roots);
    this.#inlineRoots.clear();
    let tokenBase = 0;
    for (let index = 0; index < regions.length; index++) {
      this.#inlineRoots.set(regions[index].id, { id: roots[index], tokenBase });
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
