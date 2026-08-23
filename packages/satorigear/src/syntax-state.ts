import { BlockKind } from "./constants/block.ts";
import { InlineRegion, type InlineRegionBinding, type ResolvedInlineRegion } from "./inline/region.ts";
import { emptyArray, emptySet, isSetEqual } from "./primitives.ts";
import { ContiguousSourceView, SegmentedSourceView, type SourceView } from "./source-view.ts";
import type { BlockRecord, BlockScanChange } from "./block/scanner.ts";
import type { BlockStructure } from "./block/structure.ts";
import type { BlockTokenStream } from "./block/tokens.ts";
import type { InlineProfile, InlineResolutionContext } from "./inline/profile.ts";

interface SyntaxBlock {
  record: BlockRecord;
  regions: readonly InlineRegion[];
  version: number;
}

interface BlockDefinition {
  blockIndex: number;
  key: string;
}

function firstDefinitionAtOrAfter(
  entries: readonly BlockDefinition[],
  blockIndex: number,
): number {
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (entries[middle].blockIndex < blockIndex) {
      low = middle + 1;
    }
    else {
      high = middle;
    }
  }
  return low;
}

export class SyntaxState {
  #blocks: SyntaxBlock[] = [];
  #definitionEntries?: readonly BlockDefinition[];
  #definitions: ReadonlySet<string> = emptySet;
  #profile: InlineProfile;
  #structure: BlockStructure;

  constructor(
    source: string,
    profile: InlineProfile,
    structure: BlockStructure,
  ) {
    this.#profile = profile;
    this.#structure = structure;
    this.update(source);
  }

  blocks(): readonly SyntaxBlock[] {
    return this.#blocks;
  }

  update(
    source: string,
    change?: BlockScanChange,
    offsetDelta = 0,
  ): void {
    // 1. Retain the scanner-stable prefix, then collect inline bindings from rebuilt records
    // and definitions only from the narrower token-damage window.
    const structure = this.#structure;
    const tokens = structure.tokens;
    const previousBlocks = this.#blocks;
    const stableBlockCount = change?.stableBlockCount ?? 0;
    const oldRecordStart = change?.oldRecordStart ?? 0;
    const oldRecordEnd = change?.oldRecordEnd ?? 0;
    const newRecordEnd = change?.newRecordEnd ?? structure.records.length;
    const blocks: SyntaxBlock[] = stableBlockCount === 0 ? [] : previousBlocks.slice(0, stableBlockCount);
    const previousDefinitionEntries = this.#definitionEntries ?? emptyArray;
    const oldDefinitionStart = firstDefinitionAtOrAfter(previousDefinitionEntries, oldRecordStart);
    const oldDefinitionEnd = firstDefinitionAtOrAfter(previousDefinitionEntries, oldRecordEnd);
    let replacementDefinitions: BlockDefinition[] | undefined;

    const bindings: InlineRegionBinding[] = [];
    // One flat binding list plus per-block offsets avoids allocating one list per block.
    const bindingOffsets: number[] = [];
    for (let index = stableBlockCount; index < newRecordEnd; index++) {
      const record = structure.records[index];
      bindingOffsets.push(bindings.length);
      // Semantic nodes are the non-zero ranges in the flat block token stream.
      for (let token = record.tokenStart; token < record.tokenEnd; token++) {
        const nodeLength = tokens.nodeLength(token);
        if (nodeLength === 0) {
          continue;
        }
        const rule = structure.ruleOf(token);
        if (rule.definitionKey && index >= oldRecordStart) {
          const key = rule.definitionKey(tokens, token);
          (replacementDefinitions ??= []).push({ blockIndex: index, key });
        }
        if (rule.inlineContent) {
          const inlineView = inlineViewOf(source, tokens, token, nodeLength);
          if (inlineView) {
            bindings.push({
              tokenStart: token,
              view: inlineView,
            });
          }
          token += nodeLength - 1;
        }
      }
      blocks.push({
        record,
        regions: emptyArray,
        version: 0,
      });
    }
    bindingOffsets.push(bindings.length);

    // 2. Splice definition ownership at the token-stable record boundary, then restore suffix blocks.
    const blockDelta = newRecordEnd - oldRecordEnd;
    const definitionsChanged = oldDefinitionStart !== oldDefinitionEnd || replacementDefinitions !== void 0;
    const shiftedDefinitionSuffix = blockDelta !== 0 && oldDefinitionEnd < previousDefinitionEntries.length;
    let definitionEntries = this.#definitionEntries;
    if (previousBlocks.length === 0) {
      definitionEntries = replacementDefinitions;
    }
    else if (definitionsChanged || shiftedDefinitionSuffix) {
      const nextEntries = previousDefinitionEntries.slice(0, oldDefinitionStart);
      if (replacementDefinitions) {
        nextEntries.push(...replacementDefinitions);
      }
      for (let index = oldDefinitionEnd; index < previousDefinitionEntries.length; index++) {
        const previousEntry = previousDefinitionEntries[index];
        nextEntries.push(
          blockDelta === 0
            ? previousEntry
            : { blockIndex: previousEntry.blockIndex + blockDelta, key: previousEntry.key },
        );
      }
      definitionEntries = nextEntries.length > 0 ? nextEntries : void 0;
    }

    // Reuse the lookup set when neither side of the rebuilt record range contains a definition.
    let definitions = this.#definitions;
    if (previousBlocks.length === 0 || definitionsChanged) {
      const nextDefinitions = new Set<string>();
      for (const entry of definitionEntries ?? []) {
        nextDefinitions.add(entry.key);
      }
      definitions = nextDefinitions;
    }

    // Every region in the retained suffix shares the same source-offset and token-index shifts.
    const tokenChange = change?.tokenChange;
    const suffixTokenDelta = tokenChange ? tokenChange.newEnd - tokenChange.oldEnd : 0;
    for (let index = oldRecordEnd; index < previousBlocks.length; index++) {
      const block = previousBlocks[index];
      if (offsetDelta !== 0 || suffixTokenDelta !== 0) {
        for (const region of block.regions) {
          region.shift(offsetDelta, suffixTokenDelta);
        }
      }
      blocks.push(block);
    }

    const displacedRegions: InlineRegion[] = [];
    for (let index = oldRecordStart; index < oldRecordEnd; index++) {
      for (const region of previousBlocks[index].regions) {
        displacedRegions.push(region);
      }
    }

    const displacedBindingStart = bindingOffsets[
      Math.min(oldRecordStart, newRecordEnd) - stableBlockCount
    ];
    // Token replacement already proves source-order correspondence outside its damage window,
    // so one forward cursor can reuse regions whose opening token survived the edit.
    let displacedIndex = 0;

    // 3. Rebuild region lists in source order. Prefix blocks reuse by block position;
    // displaced regions reuse only when their opening token survived token replacement.
    for (let blockIndex = stableBlockCount; blockIndex < newRecordEnd; blockIndex++) {
      const block = blocks[blockIndex];
      const previousBlock = blockIndex < oldRecordStart ? previousBlocks[blockIndex] : void 0;
      const bindingOffset = blockIndex - stableBlockCount;
      const bindingStart = bindingOffsets[bindingOffset];
      const bindingEnd = bindingOffsets[bindingOffset + 1];
      const regions = new Array<InlineRegion>(bindingEnd - bindingStart);
      for (let bindingIndex = bindingStart; bindingIndex < bindingEnd; bindingIndex++) {
        const binding = bindings[bindingIndex];
        const regionIndex = bindingIndex - bindingStart;
        let candidate = previousBlock?.regions[regionIndex];
        if (!candidate && tokenChange && bindingIndex >= displacedBindingStart) {
          const previousTokenStart = binding.tokenStart < tokenChange.oldStart
            ? binding.tokenStart
            : binding.tokenStart >= tokenChange.newEnd
              ? binding.tokenStart - suffixTokenDelta
              : -1;
          while (
            displacedIndex < displacedRegions.length &&
            displacedRegions[displacedIndex].tokenStart < previousTokenStart
          ) {
            displacedIndex++;
          }
          if (displacedRegions[displacedIndex]?.tokenStart === previousTokenStart) {
            candidate = displacedRegions[displacedIndex++];
          }
        }
        const region = candidate
          ? candidate.update(binding, definitions)
          : new InlineRegion(this.#profile, binding, definitions);
        regions[regionIndex] = region;
      }

      // Scanner-stable prefix records may survive token-equivalent edits with different source geometry.
      // Only the retained suffix can reuse fragments without comparing duplicate block text.
      block.regions = regions;
      if (previousBlock) {
        block.version = previousBlock.version + 1;
      }
    }

    // 4. Propagate changed definition visibility to retained blocks outside the rebuilt range.
    // Regions track consulted labels, so unrelated definitions do not advance block versions.
    if (
      previousBlocks.length > 0 &&
      this.#definitions !== definitions &&
      !isSetEqual(this.#definitions, definitions)
    ) {
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
      refreshDefinitions(newRecordEnd, blocks.length);
    }

    this.#blocks = blocks;
    this.#definitionEntries = definitionEntries;
    this.#definitions = definitions;
  }
}

export function resolveInlineRegions(
  source: string,
  profile: InlineProfile,
  structure: BlockStructure,
): readonly ResolvedInlineRegion[] {
  const definitions = new Set<string>();
  const regions: ResolvedInlineRegion[] = [];
  const tokens = structure.tokens;

  for (const record of structure.records) {
    // Semantic nodes are the non-zero ranges in the flat block token stream.
    for (let token = record.tokenStart; token < record.tokenEnd; token++) {
      const nodeLength = tokens.nodeLength(token);
      if (nodeLength === 0) {
        continue;
      }
      const rule = structure.ruleOf(token);
      if (rule.definitionKey) {
        definitions.add(rule.definitionKey(tokens, token));
      }
      if (rule.inlineContent) {
        const inlineView = inlineViewOf(source, tokens, token, nodeLength);
        if (inlineView) {
          regions.push({
            tokenStart: token,
            tokens: emptyArray,
            view: inlineView,
          });
        }
        token += nodeLength - 1;
      }
    }
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
  tokens: BlockTokenStream,
  tokenStart: number,
  nodeLength: number,
): SourceView | undefined {
  let firstStart = -1;
  let firstEnd = -1;
  let ranges: number[] | undefined;
  const tokenEnd = tokenStart + nodeLength;
  for (let token = tokenStart + 1; token < tokenEnd; token++) {
    if (tokens.kind(token) === BlockKind.InlineChunk) {
      const start = tokens.start(token);
      const end = tokens.end(token);
      if (firstStart < 0) {
        firstStart = start;
        firstEnd = end;
      }
      // Physically adjacent chunks still form one source slice; only stripped container gaps need segments.
      else if (start === firstEnd) {
        firstEnd = end;
        if (ranges) {
          ranges[ranges.length - 1] = end;
        }
      }
      else {
        ranges ??= [firstStart, firstEnd];
        ranges.push(start, end);
        firstEnd = end;
      }
    }
  }
  if (ranges) {
    return new SegmentedSourceView(source, ranges);
  }
  if (firstStart >= 0) {
    return new ContiguousSourceView(source, firstStart, firstEnd);
  }
}
