import {
  createDelimitedTokenResolver,
  type DelimiterRunConfig,
  type PairedTokenConfig,
} from "../inline/resolver.ts";
import { inlineKind, type InlineTokenStream } from "../inline/runtime.ts";
import type { BlockToken } from "../block/tokens.ts";

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

// Collection roles keep inline/reference discovery out of the grammar-name traversal.
export const blockInlineContent = 1;
export const blockReferenceDefinition = 2;
export type BlockContentOpcode = typeof blockInlineContent | typeof blockReferenceDefinition;

export const projectBlockQuote = 1;
export const projectUnorderedList = 2;
export const projectOrderedList = 3;
export const projectAtxHeading = 4;
export const projectSetextHeading = 5;
export const projectParagraph = 6;
export const projectThematicBreak = 7;
export const projectFencedCode = 8;
export const projectIndentedCode = 9;
export const projectHtmlBlock = 10;
export const projectLinkDefinition = 11;
export type BlockProjectionOpcode =
  | typeof projectAtxHeading
  | typeof projectBlockQuote
  | typeof projectFencedCode
  | typeof projectHtmlBlock
  | typeof projectIndentedCode
  | typeof projectLinkDefinition
  | typeof projectOrderedList
  | typeof projectParagraph
  | typeof projectSetextHeading
  | typeof projectThematicBreak
  | typeof projectUnorderedList;

export interface BlockRuleRegistration {
  inlineContent?: true;
  project: BlockProjectionOpcode;
  referenceDefinition?: true;
  rule: string;
}

export interface InlineResolutionState {
  candidates?: Set<string>;
  labels: ReadonlySet<string>;
}

// Profiles compile token semantics to numeric dispatch; projection never calls plugin callbacks per leaf.
export const projectInlineText = 1;
export const projectInlineCode = 2;
export const projectInlineHtml = 3;
export const projectInlineBreak = 4;
export const projectInlineNewline = 5;
export const projectInlineIgnore = 6;
export const projectInlineAutolink = 7;
export type InlineTokenProjectionOpcode =
  | typeof projectInlineAutolink
  | typeof projectInlineBreak
  | typeof projectInlineCode
  | typeof projectInlineHtml
  | typeof projectInlineIgnore
  | typeof projectInlineNewline
  | typeof projectInlineText;

export interface InlineTokenRegistration {
  project: InlineTokenProjectionOpcode;
  token: string;
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
  inlineTokens?: readonly InlineTokenRegistration[];
  inlineTransforms?: readonly InlineTransform[];
  tokenPairs?: readonly PairedTokenConfig<InlineResolutionState>[];
}

export interface SyntaxProfile {
  blockContents: Readonly<Record<string, BlockContentOpcode>>;
  blockFallbacks: readonly BlockStart[];
  blockInterrupts: readonly (BlockInterruptDispatch | undefined)[];
  blockProjects: Readonly<Record<string, BlockProjectionOpcode>>;
  blockStarts: readonly (BlockStartDispatch | undefined)[];
  inlineTokenProjects: readonly (InlineTokenProjectionOpcode | undefined)[];
  resolveInline: InlineTransform;
}

// Profiles bind runtime semantics to the static generated grammar without owning document state.
export function defineSyntaxProfile(plugins: readonly InternalSyntaxPlugin[]): SyntaxProfile {
  const blockContents: Record<string, BlockContentOpcode> = Object.create(null);
  const blockFallbacks: BlockStart[] = [];
  const blockInterrupts: (BlockInterruptDispatch | undefined)[] = [];
  const blockProjects: Record<string, BlockProjectionOpcode> = Object.create(null);
  const blockStarts: (BlockStartDispatch | undefined)[] = [];
  const delimiterRuns: DelimiterRunConfig[] = [];
  const inlineTransforms: InlineTransform[] = [];
  const inlineTokenProjects: (InlineTokenProjectionOpcode | undefined)[] = [];
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
        blockContents[registration.rule] = blockInlineContent;
      }
      if (registration.referenceDefinition) {
        blockContents[registration.rule] = blockReferenceDefinition;
      }
    }
    delimiterRuns.push(...plugin.delimiterRuns ?? []);
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
    blockContents,
    blockFallbacks,
    blockInterrupts,
    blockProjects,
    blockStarts,
    inlineTokenProjects,
    resolveInline,
  };
}
