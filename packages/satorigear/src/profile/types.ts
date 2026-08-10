import type { BlockLine } from "../block/lines.ts";
import type { BlockToken } from "../block/tokens.ts";
import type { DelimiterConfig, PairedTokenConfig } from "../inline/pairing.ts";
import type { InlineTokenStream } from "../inline/tokens.ts";
import type { BlockProjector, InlineLeafProjector, InlineRuleProjector } from "../mdast.ts";

export interface BlockScanContext {
  endsWithParagraphLeaf: (source: string, line: BlockLine) => boolean;
  startsInterruptingBlock: (source: string, line: BlockLine) => boolean;
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
  definitionKey?: (token: BlockToken) => string;
  inlineContent?: true;
  project?: BlockProjector;
  rule: string;
}

export type BlockProjectorDecorator = (project: BlockProjector) => BlockProjector;

export interface BlockDecoratorRegistration {
  decorate: BlockProjectorDecorator;
  rule: string;
}

export type BlockLineUnwrapper = (source: string, line: BlockLine) => BlockLine | undefined;

export type BlockRestart = (
  source: string,
  lines: readonly BlockLine[],
  changedStart: number,
  changedEnd: number,
) => number | undefined;

export interface InlineResolutionContext {
  hasDefinition: (key: string) => boolean;
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

export interface SyntaxFeature {
  blockDecorators?: readonly BlockDecoratorRegistration[];
  blockFallbacks?: readonly BlockStart[];
  blockRestart?: BlockRestart;
  blockRules?: readonly BlockRuleRegistration[];
  blockStarts?: readonly BlockStartRegistration[];
  blockUnwrappers?: readonly BlockLineUnwrapper[];
  delimiters?: readonly DelimiterConfig[];
  // Carrier transforms run before normalizers; both precede generic token pairing.
  inlineTransform?: InlineTransform;
  inlineNormalize?: InlineTransform;
  inlineRules?: readonly InlineRuleRegistration[];
  inlineTokens?: readonly InlineTokenRegistration[];
  tokenPairs?: readonly PairedTokenConfig<InlineResolutionContext>[];
}

export type BlockInterruptDispatch = BlockInterrupt | readonly BlockInterrupt[];
export type BlockStartDispatch = BlockStart | readonly BlockStart[];

export interface SyntaxProfile {
  blockFallbacks: readonly BlockStart[];
  blockInlineContents: Readonly<Record<string, true>>;
  blockInterrupts: readonly (BlockInterruptDispatch | undefined)[];
  blockProjects: Readonly<Record<string, BlockProjector>>;
  blockDefinitionKeys: Readonly<Record<string, (token: BlockToken) => string>>;
  blockRestart: BlockRestart;
  blockStarts: readonly (BlockStartDispatch | undefined)[];
  blockUnwrappers: readonly BlockLineUnwrapper[];
  decodeText: (value: string) => string;
  inlineRuleProjects: Readonly<Record<string, InlineRuleProjector>>;
  inlineTokenProjects: readonly (InlineLeafProjector | undefined)[];
  resolveInline: InlineTransform;
}
