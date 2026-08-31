// Block features compile into the immutable scanner, structure, and node builders shared by a parser.
import { Character } from "../constants/character.ts";
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

type BlockDispatch = (...args: Parameters<BlockStart>) => number;

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
  fallbacks?: readonly BlockStart[];
  rules?: readonly BlockRuleRegistration[];
  starts?: readonly BlockStartRegistration[];
}

export interface BlockProfile {
  dispatch: BlockDispatch;
  interrupts: readonly (readonly BlockInterrupt[] | undefined)[];
  lazyContinuationUnwrappers: readonly LazyContinuationUnwrapper[];
  rules: readonly (BlockSyntaxRule | undefined)[];
}

function generateBlockDispatch(
  starts: readonly (readonly BlockStart[] | undefined)[],
  fallbacks: readonly BlockStart[],
): BlockDispatch {
  try {
    const resolvers: BlockStart[] = [];
    const call = (resolve: BlockStart): string => {
      const index = resolvers.push(resolve) - 1;
      return `e=r${index}(s,l,i,o,t,c);if(e!==void 0)return e;`;
    };
    let cases = "";
    for (const code in starts) {
      cases += `case ${code}:${starts[code]!.map(call).join("")}break;`;
    }
    // Generated aliases denote source, lines, index, offset, token output, and context.
    const source = [
      `return(s,l,i,o,t,c)=>{`,
      `let e;switch(o<0?${Character.VirtualBlockIndent}:s.charCodeAt(o)){${cases}}`,
      ...fallbacks.map(call),
      `throw new Error("Syntax profile did not provide a block fallback")}`,
    ].join("");
    const names = resolvers.map((resolver, index) => `r${index}`);
    // eslint-disable-next-line no-new-func
    return Function(...names, source)(...resolvers) as BlockDispatch;
  }
  catch {
    // Dynamic function construction may be unavailable under a content security policy.
    return (source, lines, start, contentOffset, out, context) => {
      const resolvers = starts[
        contentOffset < 0 ? Character.VirtualBlockIndent : source.charCodeAt(contentOffset)
      ];
      if (resolvers) {
        for (const resolve of resolvers) {
          const end = resolve(source, lines, start, contentOffset, out, context);
          if (end !== void 0) {
            return end;
          }
        }
      }
      for (const fallback of fallbacks) {
        const end = fallback(source, lines, start, contentOffset, out, context);
        if (end !== void 0) {
          return end;
        }
      }
      throw new Error("Syntax profile did not provide a block fallback");
    };
  }
}

export function compileBlockProfile(features: readonly BlockFeature[]): BlockProfile {
  const decorators: BlockDecoratorRegistration[] = [];
  const fallbacks: BlockStart[] = [];
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
    dispatch: generateBlockDispatch(starts, fallbacks),
    interrupts,
    lazyContinuationUnwrappers,
    rules,
  };
}
