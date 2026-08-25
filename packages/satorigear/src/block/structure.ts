import type { BlockRule } from "../constants/block.ts";
import type { BlockSyntaxRule } from "./profile.ts";
import type { BlockRecord, BlockScanner } from "./scanner.ts";
import type { BlockTokenStream } from "./tokens.ts";

// This live semantic view interprets scanner-owned tokens and records under the compiled schema.
// Semantic nodes are token ranges; top-level records index those ranges in source order.
export class BlockStructure {
  #scanner: BlockScanner;
  #rules: readonly (BlockSyntaxRule | undefined)[];
  #tokens: BlockTokenStream;

  constructor(rules: readonly (BlockSyntaxRule | undefined)[], scanner: BlockScanner) {
    this.#scanner = scanner;
    this.#rules = rules;
    this.#tokens = scanner.tokens;
  }

  get records(): readonly BlockRecord[] {
    return this.#scanner.records;
  }

  get tokens(): BlockTokenStream {
    return this.#tokens;
  }

  lenOf(tokenStart: number): number {
    const tokens = this.#tokens;
    const end = tokenStart + tokens.nodeLength(tokenStart);
    return tokens.end(end - 1) - tokens.start(tokenStart);
  }

  isBlock(tokenStart: number): boolean {
    return this.ruleOf(tokenStart).block;
  }

  isRule(tokenStart: number, rule: BlockRule): boolean {
    return this.ruleOf(tokenStart).rule === rule;
  }

  ruleOf(tokenStart: number): BlockSyntaxRule {
    const kind = this.#tokens.kind(tokenStart);
    const rule = this.#rules[kind];
    if (!rule) {
      throw new Error(`Block token ${tokenStart} does not begin a semantic node`);
    }
    return rule;
  }
}
