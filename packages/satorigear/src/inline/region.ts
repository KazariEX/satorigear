import { BlockKind } from "../constants/block.ts";
import { emptyArray, emptySet, shiftTail } from "../primitives.ts";
import { SourceView } from "../source-view.ts";
import type { BlockScanChange, BlockStructure } from "../block/scanner.ts";
import type { DefinitionLookup } from "../block/tokens.ts";
import type { InlineProfile } from "./profile.ts";
import type { InlineTokenStream } from "./tokens.ts";

const definitionAny = Symbol();

export type ResolvedInlineRegion = Readonly<
  Pick<InlineRegion, "tokenStart" | "tokens" | "view">
>;

interface InlineRegion {
  tokenStart: number;
  view: SourceView;
  tokens: InlineTokenStream;
  rawTokens: InlineTokenStream;
  dependencies: ReadonlySet<string> | typeof definitionAny;
}

function isDefinitionShared(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  const smaller = left.size < right.size ? left : right;
  const larger = smaller === left ? right : left;
  for (const key of smaller) {
    if (larger.has(key)) {
      return true;
    }
  }
  return false;
}

class InlineRegionResolver implements DefinitionLookup {
  #profile: InlineProfile;
  #definitions: DefinitionLookup;
  #dependencies?: Set<string> | typeof definitionAny;

  constructor(profile: InlineProfile, definitions: DefinitionLookup) {
    this.#profile = profile;
    this.#definitions = definitions;
  }

  hasDefinition(key: string): boolean {
    if (this.#dependencies !== definitionAny) {
      this.#dependencies ??= new Set();
      this.#dependencies.add(key);
    }
    return this.#definitions.hasDefinition(key);
  }

  hasDefinitions(): boolean {
    const hasAny = this.#definitions.hasDefinitions();
    if (!hasAny) {
      // Without keys to consult, any later definition can change a bracket candidate.
      this.#dependencies = definitionAny;
    }
    return hasAny;
  }

  update(
    previous: InlineRegion | undefined,
    tokenStart: number,
    view: SourceView,
    changes: ReadonlySet<string>,
  ): InlineRegion {
    if (previous && previous.view.text === view.text) {
      previous.tokenStart = tokenStart;
      previous.view = view;
      this.updateDefinitions(previous, changes);
      return previous;
    }
    const rawTokens = view.tokenize(this.#profile.tokenize);
    const tokens = this.#resolve(view, rawTokens);
    return {
      tokenStart,
      view,
      tokens,
      rawTokens,
      dependencies: this.#dependencies ?? emptySet,
    };
  }

  updateDefinitions(region: InlineRegion, changes: ReadonlySet<string>): boolean {
    if (changes.size === 0) {
      return false;
    }
    const dependencies = region.dependencies;
    if (dependencies !== definitionAny && !isDefinitionShared(dependencies, changes)) {
      return false;
    }
    region.tokens = this.#resolve(region.view, region.rawTokens);
    region.dependencies = this.#dependencies ?? emptySet;
    return true;
  }

  #resolve(view: SourceView, rawTokens: InlineTokenStream): InlineTokenStream {
    this.#dependencies = void 0;
    return this.#profile.resolve(view.text, rawTokens, this);
  }
}

export class InlineRegionState {
  // Inline regions resolve serially, so one tracker can serve every update.
  #resolver: InlineRegionResolver;
  #regionsByBlock: (readonly InlineRegion[])[] = [];
  #structure: BlockStructure;

  constructor(profile: InlineProfile, structure: BlockStructure) {
    this.#resolver = new InlineRegionResolver(profile, structure.tokens);
    this.#structure = structure;
  }

  get regionsByBlock(): readonly (readonly ResolvedInlineRegion[])[] {
    return this.#regionsByBlock;
  }

  update(source: string, change?: BlockScanChange): readonly number[] {
    // 1. Retain the scanner-stable prefix and collect displaced regions for correspondence.
    const structure = this.#structure;
    const tokens = structure.tokens;
    const regionsByBlock = this.#regionsByBlock;
    const stableBlockCount = change?.stableBlockCount ?? 0;
    const oldRecordStart = change?.oldRecordStart ?? 0;
    const oldRecordEnd = change?.oldRecordEnd ?? 0;
    const newRecordEnd = change?.newRecordEnd ?? structure.records.length;
    const offsetDelta = change?.offsetDelta ?? 0;
    const definitionMembershipChanges = change?.tokenChange.definitionMembershipChanges ?? emptySet;
    let invalidatedBlocks: number[] | undefined;

    const tokenChange = change?.tokenChange;
    const suffixTokenDelta = tokenChange ? tokenChange.newEnd - tokenChange.oldEnd : 0;
    const displacedRegions: InlineRegion[] = [];
    for (let index = oldRecordStart; index < oldRecordEnd; index++) {
      for (const region of regionsByBlock[index]) {
        displacedRegions.push(region);
      }
    }

    // Token replacement already proves source-order correspondence outside its damage window,
    // so one forward cursor can reuse regions whose opening token survived the edit.
    let displacedIndex = 0;
    shiftTail(regionsByBlock, oldRecordEnd, newRecordEnd);

    // 2. Rebuild region lists directly from tokens. Prefix regions reuse by block position;
    // displaced regions reuse only when their opening token survived token replacement.
    for (let blockIndex = stableBlockCount; blockIndex < newRecordEnd; blockIndex++) {
      const previousRegions = blockIndex < oldRecordStart
        ? regionsByBlock[blockIndex]
        : void 0;
      const tokenStart = structure.records[blockIndex].tokenStart;
      const blockLength = tokens.nodeLength(tokenStart);
      if (blockLength === 1) {
        regionsByBlock[blockIndex] = emptyArray;
        continue;
      }
      const tokenEnd = tokenStart + blockLength;
      const regions: InlineRegion[] = [];
      // Only frames that directly own inline chunks contribute regions.
      for (let token = tokenStart; token < tokenEnd; token++) {
        const nodeLength = tokens.nodeLength(token);
        if (nodeLength <= 1 || tokens.kind(token + 1) !== BlockKind.InlineChunk) {
          continue;
        }
        const regionIndex = regions.length;
        let candidate = previousRegions?.[regionIndex];
        if (!candidate && tokenChange && blockIndex >= oldRecordStart) {
          const previousTokenStart = token < tokenChange.oldStart
            ? token
            : token >= tokenChange.newEnd
              ? token - suffixTokenDelta
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
        const view = new SourceView();
        view.reset(source, tokens, token, nodeLength);
        regions.push(this.#resolver.update(candidate, token, view, definitionMembershipChanges));
        token += nodeLength - 1;
      }

      // Token-equivalent records before the narrowed damage can reuse region caches,
      // but the scanner's rebuilt interval still requires corresponding tree rebuilds.
      regionsByBlock[blockIndex] = regions;
    }

    // 3. Shift the retained suffix only after displaced-region correspondence is complete.
    if (offsetDelta !== 0 || suffixTokenDelta !== 0) {
      for (let index = newRecordEnd; index < regionsByBlock.length; index++) {
        for (const region of regionsByBlock[index]) {
          region.tokenStart += suffixTokenDelta;
          region.view.shift(offsetDelta);
        }
      }
    }

    // 4. Propagate changed definition visibility to retained blocks outside the rebuilt range.
    // Regions track consulted labels, so unrelated definitions preserve block identity.
    if (definitionMembershipChanges.size > 0) {
      const refreshDefinitions = (start: number, end: number): void => {
        for (let index = start; index < end; index++) {
          const regions = regionsByBlock[index];
          let changed = false;
          for (const region of regions) {
            if (this.#resolver.updateDefinitions(region, definitionMembershipChanges)) {
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

    return invalidatedBlocks ?? emptyArray;
  }
}

// Block building follows source order, so projection needs only one forward cursor.
export class InlineRegionCursor {
  #index = 0;
  #regions: readonly ResolvedInlineRegion[] = emptyArray;

  reset(regions: readonly ResolvedInlineRegion[]): void {
    this.#index = 0;
    this.#regions = regions;
  }

  take(tokenStart: number): ResolvedInlineRegion | undefined {
    const region = this.#regions[this.#index];
    if (region?.tokenStart !== tokenStart) {
      return;
    }
    this.#index++;
    return region;
  }
}
