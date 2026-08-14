import type { BlockSyntaxSchema, CompiledBlockRule } from "./profile.ts";
import type { BlockTokenChange, BlockTokenStream } from "./tokens.ts";

export const noBlockEntry = Number.MIN_SAFE_INTEGER;

// Object identity remains stable for unchanged top-level blocks.
export interface BlockRecord {
  tokenEnd: number;
  tokenStart: number;
}

export interface BlockArenaChange {
  // The record update replaces old [oldStart, oldEnd) with new [oldStart, newEnd).
  readonly newEnd: number;
  readonly oldEnd: number;
  readonly oldStart: number;
}

// Semantic nodes are ranges in the scanner-owned token stream. Only top-level records carry identity.
export class BlockArena {
  #records: BlockRecord[] = [];
  #schema: BlockSyntaxSchema;
  readonly #tokens: BlockTokenStream;

  constructor(schema: BlockSyntaxSchema, tokens: BlockTokenStream) {
    this.#schema = schema;
    this.#tokens = tokens;
  }

  build(): void {
    this.#records = this.#buildRange(0, this.#tokens.length);
  }

  get records(): readonly BlockRecord[] {
    return this.#records;
  }

  get tokens(): BlockTokenStream {
    return this.#tokens;
  }

  update(change: BlockTokenChange): BlockArenaChange {
    const previous = this.#records;
    let prefixEnd = 0;
    while (prefixEnd < previous.length && previous[prefixEnd].tokenEnd <= change.oldStart) {
      prefixEnd++;
    }
    let suffixStart = prefixEnd;
    while (suffixStart < previous.length && previous[suffixStart].tokenStart < change.oldEnd) {
      suffixStart++;
    }

    const tokenDelta = change.newEnd - change.oldStart - (change.oldEnd - change.oldStart);
    const buildStart = previous[prefixEnd - 1]?.tokenEnd ?? 0;
    const oldSuffixTokenStart = previous[suffixStart]?.tokenStart;
    const buildEnd = oldSuffixTokenStart === void 0 ? this.#tokens.length : oldSuffixTokenStart + tokenDelta;
    const changed = this.#buildRange(buildStart, buildEnd);
    const suffix = previous.slice(suffixStart);
    if (tokenDelta !== 0) {
      for (const block of suffix) {
        block.tokenStart += tokenDelta;
        block.tokenEnd += tokenDelta;
      }
    }
    this.#records = [
      ...previous.slice(0, prefixEnd),
      ...changed,
      ...suffix,
    ];
    return {
      newEnd: prefixEnd + changed.length,
      oldEnd: suffixStart,
      oldStart: prefixEnd,
    };
  }

  #buildRange(start: number, end: number): BlockRecord[] {
    const records: BlockRecord[] = [];
    while (start < end) {
      const length = this.#tokens.nodeLength(start);
      if (length === 0) {
        throw new Error(`Block token ${start} does not begin a semantic node`);
      }
      records.push({ tokenStart: start, tokenEnd: start + length });
      start += length;
    }
    return records;
  }

  firstChild(tokenStart: number): number {
    return ~tokenStart;
  }

  nextChild(tokenStart: number, entry: number): number {
    const next = entry < 0 ? ~entry + 1 : entry + this.#tokens.nodeLength(entry);
    if (next >= tokenStart + this.#tokens.nodeLength(tokenStart)) {
      return noBlockEntry;
    }
    return this.#tokens.nodeLength(next) > 0 ? next : ~next;
  }

  leafToken(entry: number): number {
    return ~entry;
  }

  lenOf(tokenStart: number): number {
    const end = tokenStart + this.#tokens.nodeLength(tokenStart);
    return this.#tokens.end(end - 1) - this.#tokens.start(tokenStart);
  }

  isBlock(tokenStart: number): boolean {
    return this.ruleOf(tokenStart).block;
  }

  ruleNameOf(tokenStart: number): string {
    return this.ruleOf(tokenStart).name;
  }

  ruleOf(tokenStart: number): CompiledBlockRule {
    const kind = this.#tokens.kind(tokenStart);
    const rule = this.#schema.frameByOpen[kind]?.rule ??
      this.#schema.groupedRuleByToken[kind] ??
      this.#schema.ruleByLeaf[kind];
    if (!rule) {
      throw new Error(`Block token ${tokenStart} does not begin a semantic node`);
    }
    return rule;
  }
}
