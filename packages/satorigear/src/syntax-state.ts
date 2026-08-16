import {
  type BlockRecord,
  type BlockStructure,
  type BlockStructureChange,
  noBlockEntry,
} from "./block/structure.ts";
import { BlockKind } from "./constants/block.ts";
import { InlineRegion, type InlineRegionBinding, type ResolvedInlineRegion } from "./inline/region.ts";
import { emptyArray, emptySet, isSetEqual } from "./primitives.ts";
import { ContiguousSourceView, SegmentedSourceView, type SourceSpan, type SourceView } from "./source-view.ts";
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
  #sourceLength = 0;
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

  update(source: string, change?: BlockStructureChange, stableBlockCount = 0): void {
    // 1. Keep the scanner-stable prefix and collect definitions and inline bindings through the rebuilt range.
    const structure = this.#structure;
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
    const collectNode = (
      tokenStart: number,
      offset: number,
      tokenBase: number,
      blockIndex: number,
    ): void => {
      const rule = structure.ruleOf(tokenStart);
      const definitionKey = rule.definitionKey;
      if (definitionKey) {
        const key = definitionKey(structure.tokens, tokenBase);
        (definitionEntries ??= []).push({ blockIndex, key });
        definitions.add(key);
      }
      if (rule.inlineContent) {
        const inlineView = inlineViewOf(source, structure, tokenStart);
        if (inlineView) {
          bindings.push({
            offset,
            rule: rule.rule,
            tokenStart,
            view: inlineView,
          });
        }
        return;
      }
      for (
        let child = structure.firstChild(tokenStart);
        child !== noBlockEntry;
        child = structure.nextChild(tokenStart, child)
      ) {
        if (child >= 0) {
          collectNode(
            child,
            structure.tokens.start(child),
            child,
            blockIndex,
          );
        }
      }
    };
    // One flat list records changed-block boundaries without allocating a binding array per block.
    const bindingOffsets: number[] = [];
    for (let index = stableBlockCount; index < newEnd; index++) {
      const record = structure.records[index];
      const tokenBase = record.tokenStart;
      const offset = structure.tokens.start(tokenBase);
      bindingOffsets.push(bindings.length);
      collectNode(record.tokenStart, offset, tokenBase, index);
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
    const suffixOffsetDelta = source.length - this.#sourceLength;
    const suffixTokenDelta = change?.tokenDelta ?? 0;
    for (let index = oldEnd; index < previousBlocks.length; index++) {
      const block = previousBlocks[index];
      if (suffixOffsetDelta !== 0 || suffixTokenDelta !== 0) {
        for (const region of block.regions) {
          region.shift(suffixOffsetDelta, suffixTokenDelta);
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
    this.#sourceLength = source.length;
  }
}

export function resolveInlineRegions(
  source: string,
  profile: InlineProfile,
  structure: BlockStructure,
): readonly ResolvedInlineRegion[] {
  const definitions = new Set<string>();
  const regions: ResolvedInlineRegion[] = [];

  const collect = (tokenStart: number, tokenBase: number): void => {
    const rule = structure.ruleOf(tokenStart);
    if (rule.definitionKey) {
      definitions.add(rule.definitionKey(structure.tokens, tokenBase));
    }
    if (rule.inlineContent) {
      const inlineView = inlineViewOf(source, structure, tokenStart);
      if (inlineView) {
        regions.push({
          rule: rule.rule,
          tokenStart,
          tokens: emptyArray,
          view: inlineView,
        });
      }
      return;
    }
    for (
      let child = structure.firstChild(tokenStart);
      child !== noBlockEntry;
      child = structure.nextChild(tokenStart, child)
    ) {
      if (child >= 0) {
        collect(child, child);
      }
    }
  };
  for (const record of structure.records) {
    collect(record.tokenStart, record.tokenStart);
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
  structure: BlockStructure,
  tokenStart: number,
): SourceView | undefined {
  let firstStart = -1;
  let firstEnd = -1;
  let spans: SourceSpan[] | undefined;
  for (
    let entry = structure.firstChild(tokenStart);
    entry !== noBlockEntry;
    entry = structure.nextChild(tokenStart, entry)
  ) {
    if (entry < 0) {
      const token = structure.leafToken(entry);
      if (structure.tokens.kind(token) === BlockKind.InlineChunk) {
        const start = structure.tokens.start(token);
        const end = structure.tokens.end(token);
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
