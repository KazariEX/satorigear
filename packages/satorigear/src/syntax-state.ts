import { BlockKind } from "./block/kinds.ts";
import { InlineRegion, type InlineRegionBinding, type InlineRegionSyntax } from "./inline/region.ts";
import { emptyArray, emptySet, isSetEqual } from "./primitives.ts";
import { ContiguousSourceView, SegmentedSourceView, type SourceSpan, type SourceView } from "./source-view.ts";
import type { BlockArena, BlockArenaChange, BlockRecord } from "./block/arena.ts";
import type { InlineProfile, InlineResolutionContext } from "./inline/profile.ts";

interface SyntaxBlock {
  offset: number;
  record: BlockRecord;
  regions: readonly InlineRegion[];
  tokenBase: number;
  version: number;
}

interface BlockDefinition {
  blockIndex: number;
  key: string;
}

export class SyntaxState {
  #blocks: SyntaxBlock[] = [];
  #definitionEntries?: BlockDefinition[];
  #definitions: ReadonlySet<string> = emptySet;
  #profile: InlineProfile;
  #arena: BlockArena;

  constructor(
    source: string,
    profile: InlineProfile,
    arena: BlockArena,
  ) {
    this.#profile = profile;
    this.#arena = arena;
    this.update(source);
  }

  blocks(): readonly SyntaxBlock[] {
    return this.#blocks;
  }

  update(source: string, change?: BlockArenaChange, stableBlockCount = 0): void {
    // 1. Preserve definitions owned by the scanner-stable block prefix.
    const arena = this.#arena;
    const previousBlocks = this.#blocks;
    const blocks: SyntaxBlock[] = stableBlockCount === 0 ? [] : previousBlocks.slice(0, stableBlockCount);
    const previousDefinitionEntries = this.#definitionEntries;
    let stableDefinitionCount = 0;
    const definitions = new Set<string>();
    if (previousDefinitionEntries) {
      while (
        stableDefinitionCount < previousDefinitionEntries.length &&
        previousDefinitionEntries[stableDefinitionCount].blockIndex < stableBlockCount
      ) {
        definitions.add(previousDefinitionEntries[stableDefinitionCount].key);
        stableDefinitionCount++;
      }
    }

    // 2. Collect the rebuilt suffix before resolving inline regions,
    // because later definitions can affect references in earlier blocks.
    const bindings: InlineRegionBinding[] = [];
    let suffixDefinitionEntries: BlockDefinition[] | undefined;
    const collectNode = (
      nodeId: number,
      offset: number,
      tokenBase: number,
      blockIndex: number,
    ): void => {
      const rule = arena.ruleOf(nodeId);
      const definitionKey = rule.definitionKey;
      if (definitionKey) {
        const key = definitionKey(arena.tokens, tokenBase);
        (suffixDefinitionEntries ??= []).push({ blockIndex, key });
        definitions.add(key);
      }
      if (rule.inlineContent) {
        const inlineView = inlineViewOf(source, arena, nodeId, tokenBase);
        if (inlineView) {
          bindings.push({
            id: nodeId,
            rule: rule.name,
            span: { start: offset, end: offset + arena.lenOf(nodeId) },
            view: inlineView,
          });
        }
        return;
      }
      const childCount = arena.childCount(nodeId);
      for (let index = 0; index < childCount; index++) {
        const child = arena.childAt(nodeId, index);
        if (child >= 0) {
          collectNode(
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
    const bindingOffsets: number[] = [];
    for (let index = stableBlockCount; index < arena.records.length; index++) {
      const record = arena.records[index];
      const tokenBase = record.tokenStart;
      const offset = arena.tokens.start(tokenBase);
      bindingOffsets.push(bindings.length);
      collectNode(record.id, offset, tokenBase, index);
      blocks.push({
        offset,
        record,
        regions: emptyArray,
        tokenBase,
        version: 0,
      });
    }
    bindingOffsets.push(bindings.length);

    // 3. A fresh state has no region identity or fragment version to reconcile.
    if (previousBlocks.length === 0) {
      for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
        const bindingStart = bindingOffsets[blockIndex];
        const bindingEnd = bindingOffsets[blockIndex + 1];
        const regions = new Array<InlineRegion>(bindingEnd - bindingStart);
        for (let bindingIndex = bindingStart; bindingIndex < bindingEnd; bindingIndex++) {
          regions[bindingIndex - bindingStart] = new InlineRegion(
            this.#profile,
            bindings[bindingIndex],
            definitions,
          );
        }
        blocks[blockIndex].regions = regions;
      }
      this.#blocks = blocks;
      this.#definitionEntries = suffixDefinitionEntries;
      this.#definitions = definitions;
      return;
    }

    // 4. Refresh the stable prefix, then reconcile rebuilt blocks with reusable inline regions.
    const oldStart = change?.oldStart ?? 0;
    const oldEnd = change?.oldEnd ?? 0;
    const newEnd = change?.newEnd ?? arena.records.length;
    const definitionsChanged = stableBlockCount > 0 && !isSetEqual(this.#definitions, definitions);
    if (definitionsChanged) {
      for (let index = 0; index < stableBlockCount; index++) {
        const block = blocks[index];
        let changed = false;
        for (const region of block.regions) {
          const revision = region.revision;
          region.updateDefinitions(definitions);
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
      let previousBlock: SyntaxBlock | undefined;
      if (blockIndex < oldStart) {
        previousBlock = previousBlocks[blockIndex];
      }
      else if (blockIndex >= newEnd) {
        previousBlock = previousBlocks[oldEnd + blockIndex - newEnd];
      }
      const bindingOffset = blockIndex - stableBlockCount;
      const bindingStart = bindingOffsets[bindingOffset];
      const bindingEnd = bindingOffsets[bindingOffset + 1];
      const regions = new Array<InlineRegion>(bindingEnd - bindingStart);
      let regionsUnchanged = previousBlock !== void 0 && previousBlock.regions.length === regions.length;
      for (let bindingIndex = bindingStart; bindingIndex < bindingEnd; bindingIndex++) {
        const binding = bindings[bindingIndex];
        const regionIndex = bindingIndex - bindingStart;
        let candidate = previousBlock?.regions[regionIndex];
        if (!candidate && displacedRegions.length > 0) {
          let candidateIndex = -1;
          let nearestDistance = Number.POSITIVE_INFINITY;
          // Prefer arena identity; otherwise retain the nearest compatible lexer state.
          for (let index = 0; index < displacedRegions.length; index++) {
            const value = displacedRegions[index];
            if (value.id === binding.id) {
              candidateIndex = index;
              break;
            }
            if (value.rule === binding.rule) {
              const distance = Math.abs(value.span.start - binding.span.start);
              if (distance < nearestDistance) {
                nearestDistance = distance;
                candidateIndex = index;
              }
            }
          }
          candidate = candidateIndex < 0 ? void 0 : displacedRegions.splice(candidateIndex, 1)[0];
        }
        const revision = candidate?.revision;
        const region = candidate
          ? candidate.update(binding, definitions)
          : new InlineRegion(this.#profile, binding, definitions);
        regions[regionIndex] = region;
        regionsUnchanged &&= candidate === previousBlock?.regions[regionIndex] && revision === region.revision;
      }

      // Arena prefix records may survive token-equivalent edits with different source geometry.
      // Only the converged suffix can reuse fragments without comparing duplicate block text.
      block.regions = regions;
      if (previousBlock) {
        block.version = blockIndex >= newEnd && regionsUnchanged
          ? previousBlock.version
          : previousBlock.version + 1;
      }
    }

    // 5. Commit the new view and reuse the flat definition prefix storage when possible.
    this.#blocks = blocks;
    if (stableDefinitionCount === 0) {
      this.#definitionEntries = suffixDefinitionEntries;
    }
    else if (previousDefinitionEntries) {
      previousDefinitionEntries.length = stableDefinitionCount;
      if (suffixDefinitionEntries) {
        for (const entry of suffixDefinitionEntries) {
          previousDefinitionEntries.push(entry);
        }
      }
    }
    this.#definitions = definitions;
  }
}

export function createInlineRegions(
  source: string,
  profile: InlineProfile,
  arena: BlockArena,
): readonly InlineRegionSyntax[] {
  const definitions = new Set<string>();
  const regions: InlineRegionSyntax[] = [];

  const collect = (nodeId: number, tokenBase: number): void => {
    const rule = arena.ruleOf(nodeId);
    if (rule.definitionKey) {
      definitions.add(rule.definitionKey(arena.tokens, tokenBase));
    }
    if (rule.inlineContent) {
      const inlineView = inlineViewOf(source, arena, nodeId, tokenBase);
      if (inlineView) {
        regions.push({
          id: nodeId,
          rule: rule.name,
          tokens: emptyArray,
          view: inlineView,
        });
      }
      return;
    }
    const childCount = arena.childCount(nodeId);
    for (let index = 0; index < childCount; index++) {
      const child = arena.childAt(nodeId, index);
      if (child >= 0) {
        collect(child, tokenBase + arena.childTokRelAt(nodeId, index));
      }
    }
  };
  for (const record of arena.records) {
    collect(record.id, record.tokenStart);
  }

  // One-shot parsing needs definition visibility, but has no future edit to track dependencies for.
  const context: InlineResolutionContext = {
    hasDefinition: (key) => definitions.has(key),
    tokenize: profile.tokenize,
  };
  for (const region of regions) {
    const text = region.view.text;
    // @ts-expect-error override readonly tokens
    region.tokens = profile.resolve(
      text,
      profile.tokenize(text),
      context,
    );
  }
  return regions;
}

function inlineViewOf(
  source: string,
  arena: BlockArena,
  nodeId: number,
  tokenBase: number,
): SourceView | undefined {
  let firstStart = -1;
  let firstEnd = -1;
  let spans: SourceSpan[] | undefined;
  const childCount = arena.childCount(nodeId);
  for (let index = 0; index < childCount; index++) {
    const entry = arena.childAt(nodeId, index);
    if (entry < 0) {
      const token = arena.leafToken(entry, tokenBase);
      if (arena.tokens.kind(token) === BlockKind.InlineChunk) {
        const start = arena.tokens.start(token);
        const end = arena.tokens.end(token);
        if (firstStart < 0) {
          firstStart = start;
          firstEnd = end;
        }
        else {
          spans ??= [{ start: firstStart, end: firstEnd }];
          spans.push({ start, end });
        }
      }
    }
  }
  if (spans) {
    return new SegmentedSourceView(source, spans);
  }
  if (firstStart >= 0) {
    return new ContiguousSourceView(source, firstStart, firstEnd);
  }
}
