// Block features compile into the immutable scanner, structure, and node builders shared by a parser.
import { Character } from "../constants/character.ts";
import type { BlockKind } from "../constants/block.ts";
import type { BlockNodeBuilder } from "../fragment/block.ts";
import type { BlockLines } from "./lines.ts";
import type { BlockScanContext } from "./scanner.ts";
import type { BlockTokenStream } from "./tokens.ts";

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
  dispatch: BlockDispatch;
  interrupts: readonly (readonly BlockInterrupt[] | undefined)[];
  lazyContinuationUnwrappers: readonly LazyContinuationUnwrapper[];
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
  const builds: (BlockNodeBuilder | undefined)[] = [];
  const decorators: BlockDecoratorRegistration[] = [];
  const fallbacks: BlockStart[] = [];
  const interrupts: BlockInterrupt[][] = [];
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
    dispatch: generateBlockDispatch(starts, fallbacks),
    interrupts,
    lazyContinuationUnwrappers,
  };
}
