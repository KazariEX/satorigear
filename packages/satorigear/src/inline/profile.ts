import { inlineKind } from "./kinds.ts";
import { tokenizeInline } from "./lexer.ts";
import {
  createPairingResolver,
  type DelimiterConfig,
  type PairedTokenConfig,
} from "./pairing.ts";
import {
  compileInlineSyntax,
  type InlineStructureRegistration,
  type InlineSyntaxSchema,
} from "./syntax.ts";
import type { InlineLeafProjector, InlineRuleProjector } from "../mdast.ts";
// Inline features compile into one token pipeline and the arena/projection tables that consume it.
import type { InlineTokenStream } from "./tokens.ts";

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

export type InlineTokenRewrite = (
  source: string,
  tokens: InlineTokenStream,
  context: InlineResolutionContext,
) => InlineTokenStream;

export interface InlineFeature {
  delimiters?: readonly DelimiterConfig[];
  // Feature rewrites run in registration order; finalizers then prepare the stream for pairing.
  rewriteTokens?: InlineTokenRewrite;
  finalizeTokens?: InlineTokenRewrite;
  rules?: readonly InlineRuleRegistration[];
  structures?: readonly InlineStructureRegistration[];
  tokens?: readonly InlineTokenRegistration[];
  pairs?: readonly PairedTokenConfig[];
}

export interface InlineProfile {
  decodeText: (value: string) => string;
  resolve: InlineTokenRewrite;
  ruleProjects: Readonly<Record<string, InlineRuleProjector>>;
  schema: InlineSyntaxSchema;
  tokenize: InlineTokenizer;
  tokenProjects: readonly (InlineLeafProjector | undefined)[];
}

function composeRewrites(...rewrites: readonly InlineTokenRewrite[]): InlineTokenRewrite {
  if (rewrites.length === 1) {
    return rewrites[0];
  }
  return (source, tokens, context) => {
    for (const rewrite of rewrites) {
      tokens = rewrite(source, tokens, context);
    }
    return tokens;
  };
}

export function compileInlineProfile(
  features: readonly InlineFeature[],
  decodeText: (value: string) => string,
): InlineProfile {
  const delimiters: DelimiterConfig[] = [];
  const finalizers: InlineTokenRewrite[] = [];
  const ruleProjects: Record<string, InlineRuleProjector> = Object.create(null);
  const structures: InlineStructureRegistration[] = [];
  const tokenNames: (string | undefined)[] = [];
  const tokenProjects: (InlineLeafProjector | undefined)[] = [];
  const rewrites: InlineTokenRewrite[] = [];
  const pairs: PairedTokenConfig[] = [];

  for (const feature of features) {
    if (feature.delimiters) {
      delimiters.push(...feature.delimiters);
    }
    if (feature.finalizeTokens) {
      finalizers.push(feature.finalizeTokens);
    }
    if (feature.rules) {
      for (const registration of feature.rules) {
        ruleProjects[registration.rule] = registration.project;
      }
    }
    if (feature.structures) {
      structures.push(...feature.structures);
    }
    if (feature.tokens) {
      for (const registration of feature.tokens) {
        const kind = inlineKind(registration.token);
        tokenNames[kind] = registration.token;
        tokenProjects[kind] = registration.project;
      }
    }
    if (feature.rewriteTokens) {
      rewrites.push(feature.rewriteTokens);
    }
    if (feature.pairs) {
      pairs.push(...feature.pairs);
    }
  }

  return {
    decodeText,
    resolve: composeRewrites(
      ...rewrites,
      ...finalizers,
      createPairingResolver(delimiters, pairs),
    ),
    ruleProjects,
    schema: compileInlineSyntax(structures, tokenNames),
    tokenize: tokenizeInline,
    tokenProjects,
  };
}
