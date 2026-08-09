import {
  createDelimitedTokenResolver,
  type DelimiterRunConfig,
  type PairedTokenConfig,
} from "../inline/resolver.ts";
import { inlineKind, type InlineTokenStream } from "../inline/runtime.ts";
import type { BlockToken } from "../block/tokens.ts";
import type { BlockProjector, InlineLeafProjector, InlineRuleProjector } from "../mdast.ts";

export interface BlockLine {
  end: number;
  lazy?: boolean;
  next: number;
  prefixColumns?: number;
  start: number;
}

export type BlockStart = (
  source: string,
  lines: readonly BlockLine[],
  start: number,
  tokens: BlockToken[],
  contentOffset: number,
  profile: SyntaxProfile,
) => number | undefined;

export type BlockInterrupt = (
  source: string,
  line: BlockLine,
  contentOffset: number,
) => boolean;

export type BlockInterruptDispatch = BlockInterrupt | readonly BlockInterrupt[];
export type BlockStartDispatch = BlockStart | readonly BlockStart[];

export interface BlockStartRegistration {
  codes: readonly number[];
  interrupt?: BlockInterrupt;
  start: BlockStart;
}

export interface BlockRuleRegistration {
  inlineContent?: true;
  project: BlockProjector;
  referenceLabel?: (token: BlockToken) => string;
  rule: string;
}

export interface InlineResolutionState {
  candidates?: Set<string>;
  labels: ReadonlySet<string>;
}

export interface InlineTokenRegistration {
  project: InlineLeafProjector;
  token: string;
}

export interface InlineRuleRegistration {
  project: InlineRuleProjector;
  rule: string;
}

export type InlineTransform = (
  source: string,
  tokens: InlineTokenStream,
  state: InlineResolutionState,
) => InlineTokenStream;

export interface InternalSyntaxPlugin {
  blockFallbacks?: readonly BlockStart[];
  blockRules?: readonly BlockRuleRegistration[];
  blockStarts?: readonly BlockStartRegistration[];
  delimiterRuns?: readonly DelimiterRunConfig[];
  decodeText?: (value: string) => string;
  inlineRules?: readonly InlineRuleRegistration[];
  inlineTokens?: readonly InlineTokenRegistration[];
  inlineTransforms?: readonly InlineTransform[];
  tokenPairs?: readonly PairedTokenConfig<InlineResolutionState>[];
}

export interface SyntaxProfile {
  blockFallbacks: readonly BlockStart[];
  blockInlineContents: Readonly<Record<string, true>>;
  blockInterrupts: readonly (BlockInterruptDispatch | undefined)[];
  blockProjects: Readonly<Record<string, BlockProjector>>;
  blockReferenceLabels: Readonly<Record<string, (token: BlockToken) => string>>;
  blockStarts: readonly (BlockStartDispatch | undefined)[];
  decodeText: (value: string) => string;
  inlineRuleProjects: Readonly<Record<string, InlineRuleProjector>>;
  inlineTokenProjects: readonly (InlineLeafProjector | undefined)[];
  resolveInline: InlineTransform;
}

// Profiles bind runtime semantics to the static generated grammar without owning document state.
export function defineSyntaxProfile(plugins: readonly InternalSyntaxPlugin[]): SyntaxProfile {
  const blockFallbacks: BlockStart[] = [];
  const blockInlineContents: Record<string, true> = Object.create(null);
  const blockInterrupts: (BlockInterruptDispatch | undefined)[] = [];
  const blockProjects: Record<string, BlockProjector> = Object.create(null);
  const blockReferenceLabels: Record<string, (token: BlockToken) => string> = Object.create(null);
  const blockStarts: (BlockStartDispatch | undefined)[] = [];
  const delimiterRuns: DelimiterRunConfig[] = [];
  let decodeText = (value: string): string => value;
  const inlineRuleProjects: Record<string, InlineRuleProjector> = Object.create(null);
  const inlineTransforms: InlineTransform[] = [];
  const inlineTokenProjects: (InlineLeafProjector | undefined)[] = [];
  const tokenPairs: PairedTokenConfig<InlineResolutionState>[] = [];
  for (const plugin of plugins) {
    blockFallbacks.push(...plugin.blockFallbacks ?? []);
    for (const registration of plugin.blockStarts ?? []) {
      for (const code of registration.codes) {
        const starts = blockStarts[code];
        blockStarts[code] = !starts
          ? registration.start
          : typeof starts === "function"
            ? [starts, registration.start]
            : [...starts, registration.start];
        if (registration.interrupt) {
          const interrupts = blockInterrupts[code];
          blockInterrupts[code] = !interrupts
            ? registration.interrupt
            : typeof interrupts === "function"
              ? [interrupts, registration.interrupt]
              : [...interrupts, registration.interrupt];
        }
      }
    }
    for (const registration of plugin.blockRules ?? []) {
      blockProjects[registration.rule] = registration.project;
      if (registration.inlineContent) {
        blockInlineContents[registration.rule] = true;
      }
      if (registration.referenceLabel) {
        blockReferenceLabels[registration.rule] = registration.referenceLabel;
      }
    }
    delimiterRuns.push(...plugin.delimiterRuns ?? []);
    decodeText = plugin.decodeText ?? decodeText;
    for (const registration of plugin.inlineRules ?? []) {
      inlineRuleProjects[registration.rule] = registration.project;
    }
    for (const registration of plugin.inlineTokens ?? []) {
      inlineTokenProjects[inlineKind(registration.token)] = registration.project;
    }
    inlineTransforms.push(...plugin.inlineTransforms ?? []);
    tokenPairs.push(...plugin.tokenPairs ?? []);
  }
  const resolver = createDelimitedTokenResolver(delimiterRuns, tokenPairs);
  let resolveInline: InlineTransform;
  if (inlineTransforms.length === 0) {
    resolveInline = resolver.resolve;
  }
  else if (inlineTransforms.length === 1) {
    const transform = inlineTransforms[0];
    resolveInline = (source, tokens, state) => resolver.resolve(source, transform(source, tokens, state), state);
  }
  else {
    resolveInline = (source, tokens, state) => {
      let transformed = tokens;
      for (const transform of inlineTransforms) {
        transformed = transform(source, transformed, state);
      }
      return resolver.resolve(source, transformed, state);
    };
  }
  return {
    blockFallbacks,
    blockInlineContents,
    blockInterrupts,
    blockProjects,
    blockReferenceLabels,
    blockStarts,
    decodeText,
    inlineRuleProjects,
    inlineTokenProjects,
    resolveInline,
  };
}
