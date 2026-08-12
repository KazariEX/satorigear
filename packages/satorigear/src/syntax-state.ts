import { type BlockToken, tokenStart } from "./block/tokens.ts";
import { InlineRegion, type InlineRegionBinding } from "./inline/region.ts";
import { emptyArray, emptySet, isSetEqual } from "./primitives.ts";
import { createSourceView, type SourceSpan } from "./source-view.ts";
import type { BlockArenaChange, BlockHandle, BlockSyntaxView } from "./block/arena.ts";
import type { SyntaxProfile } from "./profile/types.ts";

export interface SyntaxBlock {
  handle: BlockHandle;
  offset: number;
  regions: readonly InlineRegion[];
  tokenBase: number;
  version: number;
}

// Block building follows source order, so inline regions need only one forward cursor.
export class InlineRegionBatch {
  #index = 0;
  #regions: readonly InlineRegion[];

  constructor(regions: readonly InlineRegion[]) {
    this.#regions = regions;
  }

  take(nodeId: number): InlineRegion | undefined {
    const region = this.#regions[this.#index];
    if (region?.id !== nodeId) {
      return;
    }
    this.#index++;
    return region;
  }
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
  arena: BlockSyntaxView["arena"],
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
  #profile: SyntaxProfile;
  #view: BlockSyntaxView;

  constructor(
    source: string,
    view: BlockSyntaxView,
    profile: SyntaxProfile,
  ) {
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
    const newEnd = change?.newEnd ?? view.blocks.length;
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
      const rule = arena.ruleOf(nodeId);
      const definitionKey = rule.definitionKey;
      if (definitionKey) {
        const key = definitionKey(view.tokenAt(tokenBase));
        (tailDefinitionEntries ??= []).push({ blockIndex, key });
        availableDefinitions.add(key);
      }
      if (rule.inlineContent) {
        const spans = inlineSpansOf(view, arena, nodeId, tokenBase);
        if (spans.length > 0) {
          bindings.push({
            id: nodeId,
            rule: rule.name,
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
    for (let index = stableBlockCount; index < view.blocks.length; index++) {
      const syntaxBlock = view.blocks[index];
      const childId = syntaxBlock.id;
      const tokenBase = syntaxBlock.tokenStart;
      const offset = tokenStart(view.tokenAt(tokenBase));
      bindingStarts.push(bindings.length);
      collect(childId, offset, tokenBase, blocks.length);
      blocks.push({
        handle: syntaxBlock,
        offset,
        regions: emptyArray,
        tokenBase,
        version: 0,
      });
    }

    // Inline resolution starts after the full definition map is known; later definitions affect earlier uses.
    const definitionsChanged = stableBlockCount > 0 && !isSetEqual(this.#definitions, availableDefinitions);
    if (definitionsChanged) {
      for (let index = 0; index < stableBlockCount; index++) {
        const block = blocks[index];
        let changed = false;
        for (const region of block.regions) {
          const revision = region.revision;
          region.updateDefinitions(availableDefinitions);
          changed ||= revision !== region.revision;
        }
        if (changed) {
          block.version++;
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
      let regionsStable = previous !== void 0 && previous.regions.length === regions.length;
      for (let bindingIndex = bindingStart; bindingIndex < bindingEnd; bindingIndex++) {
        const binding = bindings[bindingIndex];
        const regionIndex = bindingIndex - bindingStart;
        let candidate = previous?.regions[regionIndex];
        if (!candidate && displacedRegions.length > 0) {
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
        const revision = candidate?.revision;
        const region = candidate
          ? candidate.update(binding, availableDefinitions)
          : new InlineRegion(this.#profile.inline, binding, availableDefinitions);
        regions[regionIndex] = region;
        regionsStable &&= candidate === previous?.regions[regionIndex] && revision === region.revision;
      }

      // Arena prefix handles may survive token-equivalent edits with different source geometry.
      // Only the converged suffix can reuse fragments without comparing duplicate block text.
      const fragmentStable = blockIndex >= newEnd && regionsStable;
      block.regions = regions;
      block.version = previous === void 0
        ? 0
        : fragmentStable ? previous.version : previous.version + 1;
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

  inlineBatch(blocks: readonly SyntaxBlock[]): InlineRegionBatch {
    const regions: InlineRegion[] = [];
    for (const block of blocks) {
      for (const region of block.regions) {
        regions.push(region);
      }
    }
    return new InlineRegionBatch(regions);
  }
}
