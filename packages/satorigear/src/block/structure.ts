import type { BlockRule } from "../constants/block.ts";
import type { BlockSyntaxSchema, CompiledBlockRule } from "./profile.ts";
import type { BlockTokenChange, BlockTokenStream } from "./tokens.ts";

// Object identity remains stable for unchanged top-level blocks.
export interface BlockRecord {
  tokenEnd: number;
  tokenStart: number;
}

// The record update replaces old [oldStart, oldEnd) with new [oldStart, newEnd).
export interface BlockStructureChange {
  readonly newEnd: number;
  readonly oldEnd: number;
  readonly oldStart: number;
  readonly tokenDelta: number;
}

// Semantic nodes are ranges in the scanner-owned token stream. Only top-level records carry identity.
export class BlockStructure {
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

  update(change: BlockTokenChange): BlockStructureChange {
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
      tokenDelta,
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

  lenOf(tokenStart: number): number {
    const end = tokenStart + this.#tokens.nodeLength(tokenStart);
    return this.#tokens.end(end - 1) - this.#tokens.start(tokenStart);
  }

  isBlock(tokenStart: number): boolean {
    return this.ruleOf(tokenStart).block;
  }

  isRule(tokenStart: number, rule: BlockRule): boolean {
    return this.ruleOf(tokenStart).rule === rule;
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
