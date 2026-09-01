import { BlockFlag, BlockKind } from "../constants/block.ts";
import { emptyArray, emptySet } from "../primitives.ts";
import { SourceView } from "../source-view.ts";
import type { BlockScanChange, BlockStructure } from "../block/scanner.ts";
import type { BlockTokenStream, DefinitionLookup } from "../block/tokens.ts";
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

interface InlineRegionBinding {
  tokenStart: number;
  view: SourceView;
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
    binding: InlineRegionBinding,
    definitions: TrackedDefinitionLookup,
  ) {
    this.#profile = profile;
    this.tokenStart = binding.tokenStart;
    this.view = binding.view;
    this.#updateTokens(binding.view.text, definitions, emptySet);
  }

  update(
    binding: InlineRegionBinding,
    definitions: TrackedDefinitionLookup,
    definitionMembershipChanges: ReadonlySet<string>,
  ): this {
    this.#updateTokens(binding.view.text, definitions, definitionMembershipChanges);
    this.tokenStart = binding.tokenStart;
    this.view = binding.view;
    return this;
  }

  updateDefinitions(
    definitions: TrackedDefinitionLookup,
    definitionMembershipChanges: ReadonlySet<string>,
  ): boolean {
    return this.#updateTokens(this.view.text, definitions, definitionMembershipChanges);
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
    source: string,
    definitions: TrackedDefinitionLookup,
    definitionMembershipChanges: ReadonlySet<string>,
  ): boolean {
    const previousTokens = this.#rawTokens;
    const sourceUnchanged = previousTokens !== void 0 && source === this.view.text;
    if (sourceUnchanged && !this.#dependenciesChanged(definitionMembershipChanges)) {
      return false;
    }

    // Incremental regions retain exactly the definition lookups that can invalidate them.
    definitions.dependencies = void 0;
    const rawTokens = sourceUnchanged ? previousTokens : this.#profile.tokenize(source);
    const tokens = this.#profile.resolve(source, rawTokens, definitions);

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
        if (tokens.kind(token) & BlockFlag.InlineContent) {
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
        regions[regionIndex] = candidate?.update(
          binding,
          this.#lookup,
          definitionMembershipChanges,
        ) ?? new InlineRegion(this.#profile, binding, this.#lookup);
      }

      // Token-equivalent records before the narrowed damage can reuse region caches,
      // but the scanner's rebuilt interval still requires corresponding tree rebuilds.
      regionsByBlock[blockIndex] = regions;
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

export function inlineViewOf(
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
    if (tokens.kind(token) !== BlockKind.InlineChunk) {
      continue;
    }
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
  if (ranges) {
    return new SourceView(source, ranges);
  }
  if (firstStart >= 0) {
    return new SourceView(source, firstStart, firstEnd);
  }
}
