// Block features compile into the immutable scanner, structure, and node builders shared by a parser.
import type { BlockKind } from "../constants/block.ts";
import type { BlockNodeBuilder } from "../fragment/block.ts";
import type { BlockLines } from "./lines.ts";
import type { BlockScanContext } from "./scanner.ts";
import type { BlockTokenStream } from "./tokens.ts";

export type BlockStart = (
  source: string,
  lines: BlockLines,
  tokens: BlockTokenStream,
  start: number,
  contentOffset: number,
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
  interrupts: readonly (BlockInterrupt | undefined)[];
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

export function compileBlockProfile(features: readonly BlockFeature[]): BlockProfile {
  const builds: (BlockNodeBuilder | undefined)[] = [];
  const decorators: BlockDecoratorRegistration[] = [];
  const fallbacks: BlockStart[] = [];
  const interrupts: (BlockInterrupt | undefined)[] = [];
  const lazyContinuationUnwrappers: LazyContinuationUnwrapper[] = [];
  const starts: BlockStart[][] = [];

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
          const interrupt = registration.interrupt;
          if (interrupt) {
            const previous = interrupts[code];
            interrupts[code] = previous
              ? (source, lines, index, offset) => previous(source, lines, index, offset) || interrupt(source, lines, index, offset)
              : interrupt;
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
    // Shift the marker index so the virtual indent code at -1 has an array slot.
    starts: Array.from({ length: starts.length + 1 }, (_, index) => {
      const candidates = starts[index - 1];
      return candidates && composeStarts(candidates);
    }),
    fallback: composeStarts(fallbacks),
    interrupts: Array.from(interrupts),
    lazyContinuationUnwrappers,
  };
}
