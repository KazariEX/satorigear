// Block features compile into the immutable scanner, structure, and node builders shared by a parser.
import type { BlockKind, BlockRule } from "../constants/block.ts";
import type { BlockNodeBuilder } from "../fragment/block.ts";
import type { BlockLines } from "./lines.ts";
import type { BlockScanContext } from "./scanner.ts";
import type { BlockTokenStream } from "./tokens.ts";

export interface BlockSyntaxRule {
  block: boolean;
  inlineContent: boolean;
  build?: BlockNodeBuilder;
}

export type BlockStart = (
  source: string,
  lines: BlockLines,
  start: number,
  contentOffset: number,
  out: BlockTokenStream,
  context: BlockScanContext,
) => number | undefined;

type BlockFallback = (
  source: string,
  lines: BlockLines,
  start: number,
  contentOffset: number,
  out: BlockTokenStream,
  context: BlockScanContext,
) => number | undefined;

type BlockInterrupt = (
  source: string,
  lines: BlockLines,
  index: number,
  contentOffset: number,
) => boolean;

type LazyContinuationUnwrapper = (
  source: string,
  lines: BlockLines,
  index: number,
  contentOffset: number,
  target: BlockLines,
) => boolean;

interface BlockStartRegistration {
  codes: readonly number[];
  // A container owns the inverse view needed to test its lazy paragraph continuation.
  unwrapLazyContinuation?: LazyContinuationUnwrapper;
  interrupt?: BlockInterrupt;
  start: BlockStart;
}

type BlockSyntaxRegistration =
  | { kind: "block"; token: BlockKind | readonly BlockKind[] }
  | { kind: "frame"; token: BlockKind | readonly BlockKind[] }
  | { kind: "group"; token: readonly BlockKind[] }
  | { kind: "leaf"; token: BlockKind };

interface BlockRuleRegistration {
  rule: BlockRule;
  syntax: BlockSyntaxRegistration;
  build?: BlockNodeBuilder;
  inlineContent?: true;
}

export type BlockNodeBuilderDecorator = (build: BlockNodeBuilder) => BlockNodeBuilder;

interface BlockDecoratorRegistration {
  rule: BlockRule;
  decorate: BlockNodeBuilderDecorator;
}

export interface BlockFeature {
  decorators?: readonly BlockDecoratorRegistration[];
  fallbacks?: readonly BlockFallback[];
  rules?: readonly BlockRuleRegistration[];
  starts?: readonly BlockStartRegistration[];
}

export interface BlockProfile {
  fallbacks: readonly BlockFallback[];
  interrupts: readonly (readonly BlockInterrupt[] | undefined)[];
  lazyContinuationUnwrappers: readonly LazyContinuationUnwrapper[];
  rules: readonly (BlockSyntaxRule | undefined)[];
  starts: readonly (readonly BlockStart[] | undefined)[];
}

export function compileBlockProfile(features: readonly BlockFeature[]): BlockProfile {
  const decorators: BlockDecoratorRegistration[] = [];
  const fallbacks: BlockFallback[] = [];
  const interrupts: BlockInterrupt[][] = [];
  const lazyContinuationUnwrappers: LazyContinuationUnwrapper[] = [];
  const ruleByBlockRule: (BlockSyntaxRule | undefined)[] = [];
  const rules: (BlockSyntaxRule | undefined)[] = [];
  const starts: BlockStart[][] = [];

  for (const feature of features) {
    if (feature.decorators) {
      decorators.push(...feature.decorators);
    }
    if (feature.fallbacks) {
      fallbacks.push(...feature.fallbacks);
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
        const tokens = typeof syntax.token === "number" ? [syntax.token] : syntax.token;
        const rule: BlockSyntaxRule = {
          block: syntax.kind === "block" || syntax.kind === "leaf",
          inlineContent: registration.inlineContent === true,
          build: registration.build,
        };
        ruleByBlockRule[registration.rule] = rule;
        for (const token of tokens) {
          rules[token] = rule;
        }
      }
    }
  }

  for (const registration of decorators) {
    const rule = ruleByBlockRule[registration.rule];
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
    rules,
    starts,
  };
}
