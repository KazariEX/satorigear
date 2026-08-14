import { compileInlineTokenizer, type InlineLexicalRule, type InlineTokenizer } from "./lexer.ts";
import { createPairingResolver, type DelimiterConfig, type PairedTokenConfig } from "./pairing.ts";
import type { InlineLeafBuilder, InlineNodeBuilder } from "../fragment/inline.ts";
import type { InlineKind } from "./kinds.ts";
// Inline features compile into one token pipeline and the projection tables that consume it.
import type { InlineTokenStream } from "./tokens.ts";

export interface InlineResolutionContext {
  hasDefinition: (key: string) => boolean;
}

export type InlineTokenTransform = (
  source: string,
  tokens: InlineTokenStream,
  context: InlineResolutionContext,
) => InlineTokenStream;

export type InlineSyntaxDefinition =
  | {
    kind: "leaf";
    token: InlineKind;
    build: InlineLeafBuilder;
  }
  | {
    kind: "container";
    close: InlineKind;
    contentOpen: InlineKind;
    token: InlineKind;
    build: InlineNodeBuilder;
  }
  | {
    kind: "pair";
    close: InlineKind;
    open: InlineKind;
    build: InlineNodeBuilder;
  };

interface InlinePair {
  closeKind: number;
  build: InlineNodeBuilder;
}

interface InlineContainer {
  closeKind: number;
  contentOpenKind: number;
  build: InlineNodeBuilder;
}

export interface InlineSyntaxSchema {
  containerByKind: readonly (InlineContainer | undefined)[];
  pairByOpenKind: readonly (InlinePair | undefined)[];
}

export interface InlineResolutionDefinition {
  delimiters?: readonly DelimiterConfig[];
  pairs?: readonly PairedTokenConfig[];
  postTransform?: InlineTokenTransform;
  transform?: InlineTokenTransform;
}

export interface InlineFeature {
  lexical?: readonly InlineLexicalRule[];
  resolution?: InlineResolutionDefinition;
  syntax?: readonly InlineSyntaxDefinition[];
}

export interface InlineProfile {
  decodeText: (value: string) => string;
  resolve: InlineTokenTransform;
  schema: InlineSyntaxSchema;
  tokenBuilders: readonly (InlineLeafBuilder | undefined)[];
  tokenize: InlineTokenizer;
}

const ignoreInlineToken: InlineLeafBuilder = () => false;

function composeTransforms(...rewrites: readonly InlineTokenTransform[]): InlineTokenTransform {
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
  const lexicalRules: InlineLexicalRule[] = [];
  const syntaxDefinitions: InlineSyntaxDefinition[] = [];
  const pairs: PairedTokenConfig[] = [];
  const postTransforms: InlineTokenTransform[] = [];
  const transforms: InlineTokenTransform[] = [];

  for (const feature of features) {
    if (feature.lexical) {
      lexicalRules.push(...feature.lexical);
    }
    if (feature.syntax) {
      syntaxDefinitions.push(...feature.syntax);
    }
    const resolution = feature.resolution;
    if (resolution) {
      if (resolution.delimiters) {
        delimiters.push(...resolution.delimiters);
      }
      if (resolution.pairs) {
        pairs.push(...resolution.pairs);
      }
      if (resolution.transform) {
        transforms.push(resolution.transform);
      }
      if (resolution.postTransform) {
        postTransforms.push(resolution.postTransform);
      }
    }
  }

  const tokenBuilders: (InlineLeafBuilder | undefined)[] = [];
  const containerByKind: (InlineContainer | undefined)[] = [];
  const pairByOpenKind: (InlinePair | undefined)[] = [];
  const registerToken = (kind: InlineKind, build: InlineLeafBuilder): InlineKind => {
    tokenBuilders[kind] = build;
    return kind;
  };

  for (const definition of syntaxDefinitions) {
    if (definition.kind === "leaf") {
      registerToken(definition.token, definition.build);
      continue;
    }

    if (definition.kind === "container") {
      const tokenKind = registerToken(definition.token, ignoreInlineToken);
      containerByKind[tokenKind] = {
        closeKind: registerToken(definition.close, ignoreInlineToken),
        contentOpenKind: registerToken(definition.contentOpen, ignoreInlineToken),
        build: definition.build,
      };
      continue;
    }

    const openKind = registerToken(definition.open, ignoreInlineToken);
    pairByOpenKind[openKind] = {
      closeKind: registerToken(definition.close, ignoreInlineToken),
      build: definition.build,
    };
  }

  return {
    decodeText,
    resolve: composeTransforms(
      ...transforms,
      ...postTransforms,
      createPairingResolver(delimiters, pairs),
    ),
    schema: {
      containerByKind,
      pairByOpenKind,
    },
    tokenBuilders,
    tokenize: compileInlineTokenizer(lexicalRules),
  };
}
