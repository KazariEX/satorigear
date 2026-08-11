import type { BlockProjector } from "../mdast.ts";
// Block features compile into the immutable scanner, arena, and projection tables shared by a parser.
import type { BlockLine } from "./lines.ts";
import type { BlockScanContext } from "./scanner.ts";
import type { BlockSyntaxFrame, BlockSyntaxSchema } from "./syntax.ts";
import type { BlockToken } from "./tokens.ts";

export type BlockStart = (
  source: string,
  lines: readonly BlockLine[],
  start: number,
  tokens: BlockToken[],
  contentOffset: number,
  context: BlockScanContext,
) => number | undefined;

export type BlockFallback = (
  source: string,
  lines: readonly BlockLine[],
  start: number,
  tokens: BlockToken[],
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
    close: string;
    open: string | readonly string[];
  }
  | {
    kind: "group";
    tokens: readonly string[];
  }
  | {
    kind: "leaf";
    token: string;
  };

export interface BlockRuleRegistration {
  rule: string;
  syntax: BlockSyntaxRegistration;
  project?: BlockProjector;
  inlineContent?: true;
  definitionKey?: (token: BlockToken) => string;
}

export type BlockProjectorDecorator = (project: BlockProjector) => BlockProjector;

export interface BlockDecoratorRegistration {
  rule: string;
  decorate: BlockProjectorDecorator;
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
  definitionKeys: Readonly<Record<string, (token: BlockToken) => string>>;
  fallbacks: readonly BlockFallback[];
  inlineContents: Readonly<Record<string, true>>;
  interrupts: readonly (readonly BlockInterrupt[] | undefined)[];
  lazyContinuationUnwrappers: readonly LazyContinuationUnwrapper[];
  projects: Readonly<Record<string, BlockProjector>>;
  restart: BlockRestart;
  schema: BlockSyntaxSchema;
  starts: readonly (readonly BlockStart[] | undefined)[];
}

export function compileBlockProfile(features: readonly BlockFeature[]): BlockProfile {
  const decorators: BlockDecoratorRegistration[] = [];
  const fallbacks: BlockFallback[] = [];
  const inlineContents: Record<string, true> = Object.create(null);
  const frameByOpen: Record<string, BlockSyntaxFrame> = Object.create(null);
  const groupedRuleByToken: Record<string, string> = Object.create(null);
  const interrupts: BlockInterrupt[][] = [];
  const ruleByLeaf: Record<string, string> = Object.create(null);
  const projects: Record<string, BlockProjector> = Object.create(null);
  const definitionKeys: Record<string, (token: BlockToken) => string> = Object.create(null);
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
        if (syntax.kind === "block" || syntax.kind === "frame") {
          const opens = typeof syntax.open === "string" ? [syntax.open] : syntax.open;
          for (const open of opens) {
            frameByOpen[open] = {
              block: syntax.kind === "block",
              close: syntax.close,
              rule: registration.rule,
            };
          }
        }
        else if (syntax.kind === "group") {
          for (const token of syntax.tokens) {
            groupedRuleByToken[token] = registration.rule;
          }
        }
        else if (syntax.kind === "leaf") {
          ruleByLeaf[syntax.token] = registration.rule;
        }
        if (registration.project) {
          projects[registration.rule] = registration.project;
        }
        if (registration.inlineContent) {
          inlineContents[registration.rule] = true;
        }
        if (registration.definitionKey) {
          definitionKeys[registration.rule] = registration.definitionKey;
        }
      }
    }
  }

  for (const registration of decorators) {
    const project = projects[registration.rule];
    if (!project) {
      throw new Error(`Cannot decorate unknown block rule ${registration.rule}`);
    }
    projects[registration.rule] = registration.decorate(project);
  }

  return {
    definitionKeys,
    fallbacks,
    inlineContents,
    interrupts,
    lazyContinuationUnwrappers,
    projects,
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
      entryRule: "Document",
      frameByOpen,
      groupedRuleByToken,
      ruleByLeaf,
    },
    starts,
  };
}
