import type { BlockRule } from "../constants/block.ts";
import type { BlockSyntaxSchema, CompiledBlockRule } from "./profile.ts";
import type { BlockRecord, BlockScanner } from "./scanner.ts";
import type { BlockTokenStream } from "./tokens.ts";

// This live semantic view interprets scanner-owned tokens and records under the compiled schema.
// Semantic nodes are token ranges; only top-level records carry identity.
export class BlockStructure {
  #scanner: BlockScanner;
  #schema: BlockSyntaxSchema;
  #tokens: BlockTokenStream;

  constructor(schema: BlockSyntaxSchema, scanner: BlockScanner) {
    this.#scanner = scanner;
    this.#schema = schema;
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

  ruleOf(tokenStart: number): CompiledBlockRule {
    const kind = this.#tokens.kind(tokenStart);
    const rule = this.#schema.ruleByKind[kind];
    if (!rule) {
      throw new Error(`Block token ${tokenStart} does not begin a semantic node`);
    }
    return rule;
  }
}
