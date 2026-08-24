// Block features compile into the immutable scanner, structure, and node builders shared by a parser.
import { BlockKind, type BlockRule } from "../constants/block.ts";
import type { BlockNodeBuilder } from "../fragment/block.ts";
import type { BlockLine } from "./lines.ts";
import type { BlockScanContext } from "./scanner.ts";
import type { BlockTokenStream } from "./tokens.ts";

export interface CompiledBlockRule {
  block: boolean;
  close: BlockKind;
  definitionKey?: (tokens: BlockTokenStream, index: number) => string;
  inlineContent: boolean;
  rule: BlockRule;
  build?: BlockNodeBuilder;
  syntaxKind: BlockSyntaxKind;
}

export const enum BlockSyntaxKind {
  Frame,
  Group,
  Leaf,
}

export interface BlockSyntaxSchema {
  ruleByKind: readonly (CompiledBlockRule | undefined)[];
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
  rule: BlockRule;
  syntax: BlockSyntaxRegistration;
  build?: BlockNodeBuilder;
  inlineContent?: true;
  definitionKey?: (tokens: BlockTokenStream, index: number) => string;
}

export type BlockNodeBuilderDecorator = (build: BlockNodeBuilder) => BlockNodeBuilder;

export interface BlockDecoratorRegistration {
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
  schema: BlockSyntaxSchema;
  starts: readonly (readonly BlockStart[] | undefined)[];
}

export function compileBlockProfile(features: readonly BlockFeature[]): BlockProfile {
  const decorators: BlockDecoratorRegistration[] = [];
  const fallbacks: BlockFallback[] = [];
  const interrupts: BlockInterrupt[][] = [];
  const ruleByKind: (CompiledBlockRule | undefined)[] = [];
  const rules: (CompiledBlockRule | undefined)[] = [];
  const starts: BlockStart[][] = [];
  const lazyContinuationUnwrappers: LazyContinuationUnwrapper[] = [];

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
        const rule: CompiledBlockRule = {
          block: syntax.kind === "block" || syntax.kind === "leaf",
          close: syntax.kind === "block" || syntax.kind === "frame" ? syntax.close : BlockKind.None,
          definitionKey: registration.definitionKey,
          inlineContent: registration.inlineContent === true,
          rule: registration.rule,
          build: registration.build,
          syntaxKind: syntax.kind === "block" || syntax.kind === "frame"
            ? BlockSyntaxKind.Frame
            : syntax.kind === "group" ? BlockSyntaxKind.Group : BlockSyntaxKind.Leaf,
        };
        rules[registration.rule] = rule;
        if (syntax.kind === "block" || syntax.kind === "frame") {
          const opens = typeof syntax.open === "number" ? [syntax.open] : syntax.open;
          for (const open of opens) {
            ruleByKind[open] = rule;
          }
        }
        else if (syntax.kind === "group") {
          for (const token of syntax.tokens) {
            ruleByKind[token] = rule;
          }
        }
        else if (syntax.kind === "leaf") {
          ruleByKind[syntax.token] = rule;
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
    schema: {
      ruleByKind,
    },
    starts,
  };
}
