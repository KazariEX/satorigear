import type { BlockLine } from "../block/lines.ts";
import type { BlockSyntaxSchema } from "../block/syntax.ts";
import type { BlockToken } from "../block/tokens.ts";
import type { DelimiterConfig, PairedTokenConfig } from "../inline/pairing.ts";
import type { InlineStructureRegistration, InlineSyntaxSchema } from "../inline/syntax.ts";
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
    kind: "frame";
    close: string;
    open: string | readonly string[];
    wrapsBlock: boolean;
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

export type InlineTokenizer = (source: string) => InlineTokenStream;

export interface InlineResolutionContext {
  hasDefinition: (key: string) => boolean;
  tokenize: InlineTokenizer;
}

export interface InlineTokenRegistration {
  token: string;
  project: InlineLeafProjector;
}

export interface InlineRuleRegistration {
  rule: string;
  project: InlineRuleProjector;
}

export type InlineTransform = (
  source: string,
  tokens: InlineTokenStream,
  context: InlineResolutionContext,
) => InlineTokenStream;

export interface CompiledInlineSyntax {
  decodeText: (value: string) => string;
  resolve: InlineTransform;
  ruleProjects: Readonly<Record<string, InlineRuleProjector>>;
  schema: InlineSyntaxSchema;
  tokenize: InlineTokenizer;
  tokenProjects: readonly (InlineLeafProjector | undefined)[];
}

export interface BlockFeature {
  decorators?: readonly BlockDecoratorRegistration[];
  fallbacks?: readonly BlockFallback[];
  restart?: BlockRestart;
  rules?: readonly BlockRuleRegistration[];
  starts?: readonly BlockStartRegistration[];
}

export interface InlineFeature {
  delimiters?: readonly DelimiterConfig[];
  // Carrier transforms run before normalizers; both precede generic token pairing.
  transform?: InlineTransform;
  normalize?: InlineTransform;
  rules?: readonly InlineRuleRegistration[];
  structures?: readonly InlineStructureRegistration[];
  tokens?: readonly InlineTokenRegistration[];
  pairs?: readonly PairedTokenConfig<InlineResolutionContext>[];
}

export interface SyntaxFeature {
  block?: BlockFeature;
  inline?: InlineFeature;
}

export interface SyntaxProfile {
  blockFallbacks: readonly BlockFallback[];
  blockInlineContents: Readonly<Record<string, true>>;
  blockInterrupts: readonly (readonly BlockInterrupt[] | undefined)[];
  blockProjects: Readonly<Record<string, BlockProjector>>;
  blockDefinitionKeys: Readonly<Record<string, (token: BlockToken) => string>>;
  blockRestart: BlockRestart;
  blockStarts: readonly (readonly BlockStart[] | undefined)[];
  blockSyntax: BlockSyntaxSchema;
  lazyContinuationUnwrappers: readonly LazyContinuationUnwrapper[];
  inline: CompiledInlineSyntax;
}
