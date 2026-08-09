import type { BlockToken } from "../block/tokens.ts";
import type { DelimiterRunConfig, PairedTokenConfig } from "../inline/resolver.ts";
import type { InlineTokenStream } from "../inline/runtime.ts";
import type { BlockProjector, InlineLeafProjector, InlineRuleProjector } from "../mdast.ts";

export interface BlockLine {
  end: number;
  lazy?: boolean;
  next: number;
  prefixColumns?: number;
  start: number;
}

// Container plugins recurse through the document scanner without owning its control flow.
export interface BlockScanContext {
  endsWithParagraphLeaf: (source: string, line: BlockLine) => boolean;
  interruptsParagraph: (source: string, line: BlockLine) => boolean;
  resolveLines: (source: string, lines: readonly BlockLine[], tokens: BlockToken[]) => void;
}

export type BlockStart = (
  source: string,
  lines: readonly BlockLine[],
  start: number,
  tokens: BlockToken[],
  contentOffset: number,
  context: BlockScanContext,
) => number | undefined;

export type BlockInterrupt = (
  source: string,
  line: BlockLine,
  contentOffset: number,
) => boolean;

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

export type BlockLineUnwrapper = (source: string, line: BlockLine) => BlockLine | undefined;

export type BlockRestart = (
  source: string,
  lines: readonly BlockLine[],
  changedEnd: number,
) => number | undefined;

export interface InlineResolutionContext {
  hasReference: (label: string) => boolean;
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
  context: InlineResolutionContext,
) => InlineTokenStream;

export interface InternalSyntaxPlugin {
  blockFallbacks?: readonly BlockStart[];
  blockRules?: readonly BlockRuleRegistration[];
  blockRestarts?: readonly BlockRestart[];
  blockStarts?: readonly BlockStartRegistration[];
  blockUnwrappers?: readonly BlockLineUnwrapper[];
  delimiterRuns?: readonly DelimiterRunConfig[];
  decodeText?: (value: string) => string;
  inlineRules?: readonly InlineRuleRegistration[];
  inlineTokens?: readonly InlineTokenRegistration[];
  inlineTransforms?: readonly InlineTransform[];
  tokenPairs?: readonly PairedTokenConfig<InlineResolutionContext>[];
}
