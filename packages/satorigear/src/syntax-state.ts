import { InlineRegion, type InlineRegionBinding, inlineViewOf } from "./inline/region.ts";
import { emptyArray, emptySet } from "./primitives.ts";
import type { BlockScanChange, BlockStructure } from "./block/scanner.ts";
import type { InlineProfile } from "./inline/profile.ts";

export class SyntaxState {
  #profile: InlineProfile;
  #regionsByBlock: (readonly InlineRegion[])[] = [];
  #structure: BlockStructure;

  constructor(profile: InlineProfile, structure: BlockStructure) {
    this.#profile = profile;
    this.#structure = structure;
  }

  regionsByBlock(): readonly (readonly InlineRegion[])[] {
    return this.#regionsByBlock;
  }

  update(source: string, change?: BlockScanChange): readonly number[] {
    // 1. Retain the scanner-stable prefix, then collect inline bindings from rebuilt records.
    const structure = this.#structure;
    const tokens = structure.tokens;
    const previousRegionsByBlock = this.#regionsByBlock;
    const stableBlockCount = change?.stableBlockCount ?? 0;
    const oldRecordStart = change?.oldRecordStart ?? 0;
    const oldRecordEnd = change?.oldRecordEnd ?? 0;
    const newRecordEnd = change?.newRecordEnd ?? structure.records.length;
    const offsetDelta = change?.offsetDelta ?? 0;
    const definitionMembershipChanges = change?.tokenChange.definitionMembershipChanges ?? emptySet;
    const regionsByBlock = stableBlockCount === 0
      ? []
      : previousRegionsByBlock.slice(0, stableBlockCount);
    let invalidatedBlocks: number[] | undefined;

    const bindings: InlineRegionBinding[] = [];
    // One flat binding list plus per-block offsets avoids allocating one list per block.
    const bindingOffsets: number[] = [];
    for (let index = stableBlockCount; index < newRecordEnd; index++) {
      const record = structure.records[index];
      const tokenStart = record.tokenStart;
      const tokenEnd = tokenStart + tokens.nodeLength(tokenStart);
      bindingOffsets.push(bindings.length);
      // Semantic nodes are the non-zero ranges in the flat block token stream.
      for (let token = tokenStart; token < tokenEnd; token++) {
        const nodeLength = tokens.nodeLength(token);
        if (nodeLength === 0) {
          continue;
        }
        const rule = structure.ruleOf(token);
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
      regionsByBlock.push(emptyArray);
    }
    bindingOffsets.push(bindings.length);

    // 2. Every region in the retained suffix shares the same source-offset and token-index shifts.
    const tokenChange = change?.tokenChange;
    const suffixTokenDelta = tokenChange ? tokenChange.newEnd - tokenChange.oldEnd : 0;
    for (let index = oldRecordEnd; index < previousRegionsByBlock.length; index++) {
      const regions = previousRegionsByBlock[index];
      if (offsetDelta !== 0 || suffixTokenDelta !== 0) {
        for (const region of regions) {
          region.shift(offsetDelta, suffixTokenDelta);
        }
      }
      regionsByBlock.push(regions);
    }

    const displacedRegions: InlineRegion[] = [];
    for (let index = oldRecordStart; index < oldRecordEnd; index++) {
      for (const region of previousRegionsByBlock[index]) {
        displacedRegions.push(region);
      }
    }

    const displacedBindingStart = bindingOffsets[
      Math.min(oldRecordStart, newRecordEnd) - stableBlockCount
    ];
    // Token replacement already proves source-order correspondence outside its damage window,
    // so one forward cursor can reuse regions whose opening token survived the edit.
    let displacedIndex = 0;

    // 3. Rebuild region lists in source order. Prefix regions reuse by block position;
    // displaced regions reuse only when their opening token survived token replacement.
    for (let blockIndex = stableBlockCount; blockIndex < newRecordEnd; blockIndex++) {
      const previousRegions = blockIndex < oldRecordStart
        ? previousRegionsByBlock[blockIndex]
        : void 0;
      const bindingOffset = blockIndex - stableBlockCount;
      const bindingStart = bindingOffsets[bindingOffset];
      const bindingEnd = bindingOffsets[bindingOffset + 1];
      const regions = new Array<InlineRegion>(bindingEnd - bindingStart);
      for (let bindingIndex = bindingStart; bindingIndex < bindingEnd; bindingIndex++) {
        const binding = bindings[bindingIndex];
        const regionIndex = bindingIndex - bindingStart;
        let candidate = previousRegions?.[regionIndex];
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
          ? candidate.update(binding, tokens, definitionMembershipChanges)
          : new InlineRegion(this.#profile, binding, tokens);
        regions[regionIndex] = region;
      }

      // Token-equivalent records before the narrowed damage can reuse region caches,
      // but the scanner's rebuilt interval still requires corresponding tree rebuilds.
      regionsByBlock[blockIndex] = regions;
    }

    // 4. Propagate changed definition visibility to retained blocks outside the rebuilt range.
    // Regions track consulted labels, so unrelated definitions preserve block identity.
    if (
      previousRegionsByBlock.length > 0 &&
      definitionMembershipChanges.size > 0
    ) {
      const refreshDefinitions = (start: number, end: number): void => {
        for (let index = start; index < end; index++) {
          const regions = regionsByBlock[index];
          let changed = false;
          for (const region of regions) {
            if (region.updateDefinitions(tokens, definitionMembershipChanges)) {
              changed = true;
            }
          }
          if (changed) {
            (invalidatedBlocks ??= []).push(index);
          }
        }
      };
      refreshDefinitions(0, stableBlockCount);
      refreshDefinitions(newRecordEnd, regionsByBlock.length);
    }

    this.#regionsByBlock = regionsByBlock;

    return invalidatedBlocks ?? emptyArray;
  }
}
