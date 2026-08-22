import { BlockKind } from "./constants/block.ts";
import { InlineRegion, type InlineRegionBinding, type ResolvedInlineRegion } from "./inline/region.ts";
import { emptyArray, emptySet, isSetEqual } from "./primitives.ts";
import { ContiguousSourceView, SegmentedSourceView, type SourceView } from "./source-view.ts";
import type { BlockRecord, BlockStructure, BlockStructureChange } from "./block/structure.ts";
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

export class SyntaxState {
  #blocks: SyntaxBlock[] = [];
  #definitionEntries?: BlockDefinition[];
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
    change?: BlockStructureChange,
    stableBlockCount = 0,
    offsetDelta = 0,
  ): void {
    // 1. Keep the scanner-stable prefix and collect definitions and inline bindings through the rebuilt range.
    const structure = this.#structure;
    const tokens = structure.tokens;
    const previousBlocks = this.#blocks;
    const oldStart = change?.oldStart ?? 0;
    const oldEnd = change?.oldEnd ?? 0;
    const newEnd = change?.newEnd ?? structure.records.length;
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
    // One flat list records changed-block boundaries without allocating a binding array per block.
    const bindingOffsets: number[] = [];
    for (let index = stableBlockCount; index < newEnd; index++) {
      const record = structure.records[index];
      bindingOffsets.push(bindings.length);
      // Semantic nodes are the non-zero ranges in the flat block token stream.
      for (let token = record.tokenStart; token < record.tokenEnd; token++) {
        const nodeLength = tokens.nodeLength(token);
        if (nodeLength === 0) {
          continue;
        }
        const rule = structure.ruleOf(token);
        const definitionKey = rule.definitionKey;
        if (definitionKey) {
          const key = definitionKey(tokens, token);
          (definitionEntries ??= []).push({ blockIndex: index, key });
          definitions.add(key);
        }
        if (rule.inlineContent) {
          const inlineView = inlineViewOf(source, tokens, token, nodeLength);
          if (inlineView) {
            bindings.push({
              offset: tokens.start(token),
              rule: rule.rule,
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

    // 2. Restore the scanner-converged suffix. Its definitions, regions and tokens remain valid;
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

    // Scanner convergence makes every record in the retained suffix share the document-length shift.
    const suffixTokenDelta = change?.tokenDelta ?? 0;
    for (let index = oldEnd; index < previousBlocks.length; index++) {
      const block = previousBlocks[index];
      if (offsetDelta !== 0 || suffixTokenDelta !== 0) {
        for (const region of block.regions) {
          region.shift(offsetDelta, suffixTokenDelta);
        }
      }
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
          // Prefer the same token slot; otherwise retain the nearest compatible lexer state.
          for (let index = 0; index < displacedRegions.length; index++) {
            const value = displacedRegions[index];
            if (value.tokenStart === binding.tokenStart) {
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

      // Scanner-stable prefix records may survive token-equivalent edits with different source geometry.
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
            rule: rule.rule,
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
      else {
        ranges ??= [firstStart, firstEnd];
        ranges.push(start, end);
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
