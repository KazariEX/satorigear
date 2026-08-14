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
    // 1. Keep the scanner-stable prefix and collect syntax only through the arena damage range.
    const arena = this.#arena;
    const previousBlocks = this.#blocks;
    const oldStart = change?.oldStart ?? 0;
    const oldEnd = change?.oldEnd ?? 0;
    const newEnd = change?.newEnd ?? arena.records.length;
    const blocks: SyntaxBlock[] = stableBlockCount === 0 ? [] : previousBlocks.slice(0, stableBlockCount);
    const previousDefinitionEntries = this.#definitionEntries;
    const definitions = new Set<string>();
    let definitionEntries: BlockDefinition[] | undefined;
    let definitionIndex = 0;
    if (previousDefinitionEntries) {
      while (
        definitionIndex < previousDefinitionEntries.length &&
        previousDefinitionEntries[definitionIndex].blockIndex < stableBlockCount
      ) {
        const entry = previousDefinitionEntries[definitionIndex++];
        (definitionEntries ??= []).push(entry);
        definitions.add(entry.key);
      }
    }

    const bindings: InlineRegionBinding[] = [];
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
        (definitionEntries ??= []).push({ blockIndex, key });
        definitions.add(key);
      }
      if (rule.inlineContent) {
        const inlineView = inlineViewOf(source, arena, nodeId, tokenBase);
        if (inlineView) {
          bindings.push({
            id: nodeId,
            offset,
            rule: rule.name,
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
    // One flat list records changed-block boundaries without allocating a binding array per block.
    const bindingOffsets: number[] = [];
    for (let index = stableBlockCount; index < newEnd; index++) {
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

    // 2. Restore the arena-converged suffix. Its definitions, regions and tokens remain valid;
    // only block indexes and absolute source geometry may move after an insertion or deletion.
    if (previousDefinitionEntries) {
      while (
        definitionIndex < previousDefinitionEntries.length &&
        previousDefinitionEntries[definitionIndex].blockIndex < oldEnd
      ) {
        definitionIndex++;
      }
      const blockDelta = newEnd - oldEnd;
      while (definitionIndex < previousDefinitionEntries.length) {
        const previousEntry = previousDefinitionEntries[definitionIndex++];
        const entry = { blockIndex: previousEntry.blockIndex + blockDelta, key: previousEntry.key };
        (definitionEntries ??= []).push(entry);
        definitions.add(entry.key);
      }
    }

    const firstSuffixBlock = previousBlocks[oldEnd];
    const firstSuffixRecord = arena.records[newEnd];
    // Relative arena edges make every record in the converged suffix share these two shifts.
    const suffixOffsetDelta = firstSuffixBlock && firstSuffixRecord
      ? arena.tokens.start(firstSuffixRecord.tokenStart) - firstSuffixBlock.offset
      : 0;
    const suffixTokenDelta = firstSuffixBlock && firstSuffixRecord
      ? firstSuffixRecord.tokenStart - firstSuffixBlock.tokenBase
      : 0;
    for (let index = oldEnd; index < previousBlocks.length; index++) {
      const block = previousBlocks[index];
      if (suffixOffsetDelta !== 0) {
        for (const region of block.regions) {
          region.shift(suffixOffsetDelta);
        }
      }
      block.offset += suffixOffsetDelta;
      block.tokenBase += suffixTokenDelta;
      blocks.push(block);
    }

    const displacedRegions: InlineRegion[] = [];
    for (let index = oldStart; index < oldEnd; index++) {
      for (const region of previousBlocks[index].regions) {
        displacedRegions.push(region);
      }
    }

    // 3. Reconcile only rebuilt blocks. Compatible displaced regions retain their lexer state;
    // converged suffix regions never enter this path.
    for (let blockIndex = stableBlockCount; blockIndex < newEnd; blockIndex++) {
      const block = blocks[blockIndex];
      const previousBlock = blockIndex < oldStart ? previousBlocks[blockIndex] : void 0;
      const bindingOffset = blockIndex - stableBlockCount;
      const bindingStart = bindingOffsets[bindingOffset];
      const bindingEnd = bindingOffsets[bindingOffset + 1];
      const regions = new Array<InlineRegion>(bindingEnd - bindingStart);
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
              const distance = Math.abs(value.offset - binding.offset);
              if (distance < nearestDistance) {
                nearestDistance = distance;
                candidateIndex = index;
              }
            }
          }
          candidate = candidateIndex < 0 ? void 0 : displacedRegions.splice(candidateIndex, 1)[0];
        }
        const region = candidate
          ? candidate.update(binding, definitions)
          : new InlineRegion(this.#profile, binding, definitions);
        regions[regionIndex] = region;
      }

      // Arena prefix records may survive token-equivalent edits with different source geometry.
      // Only the converged suffix can reuse fragments without comparing duplicate block text.
      block.regions = regions;
      if (previousBlock) {
        block.version = previousBlock.version + 1;
      }
    }

    // 4. A definition change only revisits regions that survived outside the rebuilt range. Each region
    // tracks the labels it consulted, so unrelated definitions leave its fragment version untouched.
    if (previousBlocks.length > 0 && !isSetEqual(this.#definitions, definitions)) {
      const refreshDefinitions = (start: number, end: number): void => {
        for (let index = start; index < end; index++) {
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
      };
      refreshDefinitions(0, stableBlockCount);
      refreshDefinitions(newEnd, blocks.length);
    }

    this.#blocks = blocks;
    this.#definitionEntries = definitionEntries;
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
