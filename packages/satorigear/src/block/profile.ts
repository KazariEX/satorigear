import type { BlockNodeBuilder } from "../fragment/block.ts";
// Block features compile into the immutable scanner, arena, and node builders shared by a parser.
import type { BlockKind } from "./kinds.ts";
import type { BlockLine } from "./lines.ts";
import type { BlockScanContext } from "./scanner.ts";
import type { BlockTokenStream } from "./tokens.ts";

export interface CompiledBlockRule {
  block: boolean;
  definitionKey?: (tokens: BlockTokenStream, index: number) => string;
  inlineContent: boolean;
  name: string;
  build?: BlockNodeBuilder;
}

export interface BlockSyntaxFrame {
  close: BlockKind;
  rule: CompiledBlockRule;
}

export interface BlockSyntaxSchema {
  frameByOpen: readonly (BlockSyntaxFrame | undefined)[];
  groupedRuleByToken: readonly (CompiledBlockRule | undefined)[];
  ruleByLeaf: readonly (CompiledBlockRule | undefined)[];
}

export type BlockStart = (
  source: string,
  lines: readonly BlockLine[],
  start: number,
  tokens: BlockTokenStream,
  contentOffset: number,
  context: BlockScanContext,
) => number | undefined;

export type BlockFallback = (
  source: string,
  lines: readonly BlockLine[],
  start: number,
  tokens: BlockTokenStream,
  context: BlockScanContext,
) => number | undefined;

export type BlockInterrupt = (
  source: string,
  line: BlockLine,
  contentOffset: number,
) => boolean;

export type LazyContinuationUnwrapper = (source: string, line: BlockLine) => BlockLine | undefined;

export interface BlockStartRegistration {
  codes: readonly number[];
  // A container owns the inverse view needed to test its lazy paragraph continuation.
  unwrapLazyContinuation?: LazyContinuationUnwrapper;
  interrupt?: BlockInterrupt;
  start: BlockStart;
}

export type BlockSyntaxRegistration =
  | {
    kind: "block" | "frame";
    close: BlockKind;
    open: BlockKind | readonly BlockKind[];
  }
  | {
    kind: "group";
    tokens: readonly BlockKind[];
  }
  | {
    kind: "leaf";
    token: BlockKind;
  };

export interface BlockRuleRegistration {
  rule: string;
  syntax: BlockSyntaxRegistration;
  build?: BlockNodeBuilder;
  inlineContent?: true;
  definitionKey?: (tokens: BlockTokenStream, index: number) => string;
}

export type BlockNodeBuilderDecorator = (build: BlockNodeBuilder) => BlockNodeBuilder;

export interface BlockDecoratorRegistration {
  rule: string;
  decorate: BlockNodeBuilderDecorator;
}

export type BlockRestart = (
  source: string,
  lines: readonly BlockLine[],
  changedStart: number,
  changedEnd: number,
) => number | undefined;

export interface BlockFeature {
  decorators?: readonly BlockDecoratorRegistration[];
  fallbacks?: readonly BlockFallback[];
  restart?: BlockRestart;
  rules?: readonly BlockRuleRegistration[];
  starts?: readonly BlockStartRegistration[];
}

export interface BlockProfile {
  fallbacks: readonly BlockFallback[];
  interrupts: readonly (readonly BlockInterrupt[] | undefined)[];
  lazyContinuationUnwrappers: readonly LazyContinuationUnwrapper[];
  restart: BlockRestart;
  schema: BlockSyntaxSchema;
  starts: readonly (readonly BlockStart[] | undefined)[];
}

export function compileBlockProfile(features: readonly BlockFeature[]): BlockProfile {
  const decorators: BlockDecoratorRegistration[] = [];
  const fallbacks: BlockFallback[] = [];
  const frameByOpen: (BlockSyntaxFrame | undefined)[] = [];
  const groupedRuleByToken: (CompiledBlockRule | undefined)[] = [];
  const interrupts: BlockInterrupt[][] = [];
  const ruleByLeaf: (CompiledBlockRule | undefined)[] = [];
  const rules: Record<string, CompiledBlockRule> = Object.create(null);
  const restarts: BlockRestart[] = [];
  const starts: BlockStart[][] = [];
  const lazyContinuationUnwrappers: LazyContinuationUnwrapper[] = [];

  for (const feature of features) {
    if (feature.decorators) {
      decorators.push(...feature.decorators);
    }
    if (feature.fallbacks) {
      fallbacks.push(...feature.fallbacks);
    }
    if (feature.restart) {
      restarts.push(feature.restart);
    }
    if (feature.starts) {
      for (const registration of feature.starts) {
        if (registration.unwrapLazyContinuation) {
          lazyContinuationUnwrappers.push(registration.unwrapLazyContinuation);
        }
        for (const code of registration.codes) {
          (starts[code] ??= []).push(registration.start);
          if (registration.interrupt) {
            (interrupts[code] ??= []).push(registration.interrupt);
          }
        }
      }
    }
    if (feature.rules) {
      for (const registration of feature.rules) {
        const syntax = registration.syntax;
        const rule: CompiledBlockRule = {
          block: syntax.kind === "block" || syntax.kind === "leaf",
          definitionKey: registration.definitionKey,
          inlineContent: registration.inlineContent === true,
          name: registration.rule,
          build: registration.build,
        };
        rules[registration.rule] = rule;
        if (syntax.kind === "block" || syntax.kind === "frame") {
          const opens = typeof syntax.open === "number" ? [syntax.open] : syntax.open;
          for (const open of opens) {
            frameByOpen[open] = {
              close: syntax.close,
              rule,
            };
          }
        }
        else if (syntax.kind === "group") {
          for (const token of syntax.tokens) {
            groupedRuleByToken[token] = rule;
          }
        }
        else if (syntax.kind === "leaf") {
          ruleByLeaf[syntax.token] = rule;
        }
      }
    }
  }

  for (const registration of decorators) {
    const rule = rules[registration.rule];
    const build = rule?.build;
    if (!build) {
      throw new Error(`Cannot decorate unknown block rule ${registration.rule}`);
    }
    rule.build = registration.decorate(build);
  }

  return {
    fallbacks,
    interrupts,
    lazyContinuationUnwrappers,
    restart(source, lines, changedStart, changedEnd) {
      let result: number | undefined;
      for (const restart of restarts) {
        const candidate = restart(source, lines, changedStart, changedEnd);
        if (candidate !== void 0 && (result === void 0 || candidate < result)) {
          result = candidate;
        }
      }
      return result;
    },
    schema: {
      frameByOpen,
      groupedRuleByToken,
      ruleByLeaf,
    },
    starts,
  };
}
