import type { TopLevelContent } from "mdast";
import { BlockKind } from "../constants/block.ts";
import type { BlockNodeBuilder } from "../fragment/block.ts";
import type { SourceSpan } from "../source-view.ts";
import type { BlockLines } from "./lines.ts";
import type { BlockScanContext } from "./scanner.ts";
import type { BlockTokenStream } from "./tokens.ts";

// Completed leaves have no children whose positions or references still need projection.
export interface DirectNode extends SourceSpan {
  node: Exclude<TopLevelContent, { children: unknown }>;
  nextLine: number;
}

export type BlockStart = (
  source: string,
  lines: BlockLines,
  tokens: BlockTokenStream,
  start: number,
  contentOffset: number,
  context: BlockScanContext,
) => number | DirectNode | undefined;

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

export interface BlockStartRegistration {
  codes: readonly number[];
  // A container owns the inverse view needed to test its lazy paragraph continuation.
  unwrapLazyContinuation?: LazyContinuationUnwrapper;
  interrupt?: BlockInterrupt;
  start: BlockStart;
}

interface BlockBuildRegistration {
  token: BlockKind | readonly BlockKind[];
  build: BlockNodeBuilder;
}

interface BlockDecoratorRegistration {
  token: BlockKind | readonly BlockKind[];
  decorate: (build: BlockNodeBuilder) => BlockNodeBuilder;
}

export interface BlockFeature {
  builds?: readonly BlockBuildRegistration[];
  decorators?: readonly BlockDecoratorRegistration[];
  fallbacks?: readonly BlockStart[];
  starts?: readonly BlockStartRegistration[];
}

export interface BlockProfile {
  builds: readonly (BlockNodeBuilder | undefined)[];
  starts: readonly (BlockStart | undefined)[];
  fallback: BlockStart | undefined;
  interrupt: BlockInterrupt;
  lazyContinuationUnwrappers: readonly LazyContinuationUnwrapper[];
}

function composeStarts(starts: readonly BlockStart[]): BlockStart | undefined {
  let chain: BlockStart | undefined;
  for (let index = starts.length - 1; index >= 0; index--) {
    const start = starts[index];
    const next = chain;
    chain = next
      ? (source, lines, tokens, index, offset, context) => (
        start(source, lines, tokens, index, offset, context) ??
        next(source, lines, tokens, index, offset, context)
      )
      : start;
  }
  return chain;
}

function composeInterrupts(interrupts: BlockInterrupt[][]): BlockInterrupt {
  const chains = interrupts.map((candidates) => {
    let chain: BlockInterrupt | undefined;
    for (let index = candidates.length - 1; index >= 0; index--) {
      const start = candidates[index];
      const next = chain;
      chain = next
        ? (source, lines, index, offset) => (
          start(source, lines, index, offset) || next(source, lines, index, offset)
        )
        : start;
    }
    return chain;
  });
  return (source, lines, index, offset) => {
    return offset >= 0 && chains[source.charCodeAt(offset)]?.(source, lines, index, offset) || false;
  };
}

export function compileBlockProfile(features: readonly BlockFeature[]): BlockProfile {
  const builds: (BlockNodeBuilder | undefined)[] = [];
  const decorators: BlockDecoratorRegistration[] = [];
  const fallbacks: BlockStart[] = [];
  const interrupts: BlockInterrupt[][] = [];
  const lazyContinuationUnwrappers: LazyContinuationUnwrapper[] = [];
  const starts: BlockStart[][] = [];

  builds[BlockKind.DirectNode] = (token, context) => {
    const tokens = context.structure.tokens;
    const node = tokens.node(token)!;
    node.position = context.locator.positionAt(tokens.start(token), tokens.end(token));
    return node;
  };

  for (const feature of features) {
    if (feature.builds) {
      for (const registration of feature.builds) {
        const token = registration.token;
        const tokens = typeof token === "number" ? [token] : token;
        for (const token of tokens) {
          builds[token] = registration.build;
        }
      }
    }
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
  }

  for (const registration of decorators) {
    const token = registration.token;
    const tokens = typeof token === "number" ? [token] : token;
    for (const token of tokens) {
      const build = builds[token];
      if (!build) {
        throw new Error(`Cannot decorate unknown block token ${token}`);
      }
      builds[token] = registration.decorate(build);
    }
  }

  return {
    builds,
    starts: Array.from({ length: starts.length + 1 }, (val, index) => {
      const candidates = starts[index - 1];
      return candidates && composeStarts(candidates);
    }),
    fallback: composeStarts(fallbacks),
    interrupt: composeInterrupts(interrupts),
    lazyContinuationUnwrappers,
  };
}
