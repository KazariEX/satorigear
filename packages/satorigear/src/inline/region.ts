import { BlockKind } from "../constants/block.ts";
import { emptyArray, emptySet } from "../primitives.ts";
import { SourceView } from "../source-view.ts";
import type { BlockScanChange, BlockStructure } from "../block/scanner.ts";
import type { DefinitionLookup } from "../block/tokens.ts";
import type { InlineProfile } from "./profile.ts";
import type { InlineTokenStream } from "./tokens.ts";

const definitionAny = Symbol();

class TrackedDefinitionLookup implements DefinitionLookup {
  readonly definitions: DefinitionLookup;
  dependencies?: Set<string | typeof definitionAny>;

  constructor(definitions: DefinitionLookup) {
    this.definitions = definitions;
  }

  hasDefinition(key: string): boolean {
    (this.dependencies ??= new Set()).add(key);
    return this.definitions.hasDefinition(key);
  }

  hasDefinitions(): boolean {
    const hasAny = this.definitions.hasDefinitions();
    if (!hasAny) {
      // Without keys to consult, any later definition can change a bracket candidate.
      (this.dependencies ??= new Set()).add(definitionAny);
    }
    return hasAny;
  }
}

export interface ResolvedInlineRegion {
  readonly tokenStart: number;
  readonly tokens: InlineTokenStream;
  readonly view: SourceView;
}

class InlineRegion implements ResolvedInlineRegion {
  // Track consulted definitions, or all future definitions when no concrete key can be consulted.
  #definitionDependencies!: ReadonlySet<string | typeof definitionAny>;
  // Keep unresolved tokens so a definition-map change can re-resolve without re-lexing unchanged text.
  #rawTokens?: InlineTokenStream;
  #profile: InlineProfile;
  tokens!: InlineTokenStream;
  tokenStart: number;
  view: SourceView;

  constructor(
    profile: InlineProfile,
    tokenStart: number,
    view: SourceView,
    definitions: TrackedDefinitionLookup,
  ) {
    this.#profile = profile;
    this.tokenStart = tokenStart;
    this.view = view;
    this.#updateTokens(view, definitions, emptySet);
  }

  update(
    tokenStart: number,
    view: SourceView,
    definitions: TrackedDefinitionLookup,
    definitionMembershipChanges: ReadonlySet<string>,
  ): this {
    this.#updateTokens(view, definitions, definitionMembershipChanges);
    this.tokenStart = tokenStart;
    this.view = view;
    return this;
  }

  updateDefinitions(
    definitions: TrackedDefinitionLookup,
    definitionMembershipChanges: ReadonlySet<string>,
  ): boolean {
    return this.#updateTokens(this.view, definitions, definitionMembershipChanges);
  }

  shift(delta: number, tokenDelta: number): void {
    this.tokenStart += tokenDelta;
    this.view.shift(delta);
  }

  #dependenciesChanged(definitionMembershipChanges: ReadonlySet<string>): boolean {
    const dependencies = this.#definitionDependencies;
    if (dependencies.has(definitionAny)) {
      return definitionMembershipChanges.size > 0;
    }
    // The sentinel case returned above, so all remaining dependencies are labels.
    const labels = dependencies as ReadonlySet<string>;
    // Definition-heavy edits stay linear in the smaller side of the intersection.
    if (labels.size < definitionMembershipChanges.size) {
      for (const key of labels) {
        if (definitionMembershipChanges.has(key)) {
          return true;
        }
      }
    }
    else {
      for (const key of definitionMembershipChanges) {
        if (dependencies.has(key)) {
          return true;
        }
      }
    }
    return false;
  }

  #updateTokens(
    view: SourceView,
    definitions: TrackedDefinitionLookup,
    definitionMembershipChanges: ReadonlySet<string>,
  ): boolean {
    const previousTokens = this.#rawTokens;
    const sourceUnchanged = previousTokens !== void 0 && view.text === this.view.text;
    if (sourceUnchanged && !this.#dependenciesChanged(definitionMembershipChanges)) {
      return false;
    }

    // Incremental regions retain exactly the definition lookups that can invalidate them.
    definitions.dependencies = void 0;
    const rawTokens = sourceUnchanged ? previousTokens : this.#profile.tokenize(view.text, view.withBoundaryBreak);
    const tokens = this.#profile.resolve(view.text, rawTokens, definitions);

    this.#definitionDependencies = definitions.dependencies ?? emptySet;
    this.#rawTokens = rawTokens;
    this.tokens = tokens;
    return true;
  }
}

export class InlineRegionState {
  // Inline regions resolve serially, so one tracker can serve every update.
  #lookup: TrackedDefinitionLookup;
  #profile: InlineProfile;
  #regionsByBlock: (readonly InlineRegion[])[] = [];
  #structure: BlockStructure;

  constructor(profile: InlineProfile, structure: BlockStructure) {
    this.#lookup = new TrackedDefinitionLookup(structure.tokens);
    this.#profile = profile;
    this.#structure = structure;
  }

  regionsByBlock(): readonly (readonly InlineRegion[])[] {
    return this.#regionsByBlock;
  }

  update(source: string, change?: BlockScanChange): readonly number[] {
    // 1. Retain the scanner-stable prefix and collect displaced regions for correspondence.
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

    const tokenChange = change?.tokenChange;
    const suffixTokenDelta = tokenChange ? tokenChange.newEnd - tokenChange.oldEnd : 0;
    const displacedRegions: InlineRegion[] = [];
    for (let index = oldRecordStart; index < oldRecordEnd; index++) {
      for (const region of previousRegionsByBlock[index]) {
        displacedRegions.push(region);
      }
    }

    // Token replacement already proves source-order correspondence outside its damage window,
    // so one forward cursor can reuse regions whose opening token survived the edit.
    let displacedIndex = 0;

    // 2. Rebuild region lists directly from tokens. Prefix regions reuse by block position;
    // displaced regions reuse only when their opening token survived token replacement.
    for (let blockIndex = stableBlockCount; blockIndex < newRecordEnd; blockIndex++) {
      const previousRegions = blockIndex < oldRecordStart
        ? previousRegionsByBlock[blockIndex]
        : void 0;
      const tokenStart = structure.records[blockIndex].tokenStart;
      const tokenEnd = tokenStart + tokens.nodeLength(tokenStart);
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
        const view = new SourceView(source, tokens, token, nodeLength);
        regions.push(
          candidate?.update(token, view, this.#lookup, definitionMembershipChanges) ??
          new InlineRegion(this.#profile, token, view, this.#lookup),
        );
        token += nodeLength - 1;
      }

      // Token-equivalent records before the narrowed damage can reuse region caches,
      // but the scanner's rebuilt interval still requires corresponding tree rebuilds.
      regionsByBlock.push(regions);
    }

    // 3. Shift the retained suffix only after displaced-region correspondence is complete.
    for (let index = oldRecordEnd; index < previousRegionsByBlock.length; index++) {
      const regions = previousRegionsByBlock[index];
      if (offsetDelta !== 0 || suffixTokenDelta !== 0) {
        for (const region of regions) {
          region.shift(offsetDelta, suffixTokenDelta);
        }
      }
      regionsByBlock.push(regions);
    }

    // 4. Propagate changed definition visibility to retained blocks outside the rebuilt range.
    // Regions track consulted labels, so unrelated definitions preserve block identity.
    if (previousRegionsByBlock.length > 0 && definitionMembershipChanges.size > 0) {
      const refreshDefinitions = (start: number, end: number): void => {
        for (let index = start; index < end; index++) {
          const regions = regionsByBlock[index];
          let changed = false;
          for (const region of regions) {
            if (region.updateDefinitions(this.#lookup, definitionMembershipChanges)) {
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
