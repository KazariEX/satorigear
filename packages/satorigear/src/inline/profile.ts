import { compileInlineTokenizer, type InlineLexicalRule, type InlineTokenizer } from "./lexer.ts";
import { createPairingResolver, type DelimiterConfig, type PairedTokenConfig } from "./pairing.ts";
import type {
  InlineLeafBuilder,
  InlineNodeBuilder,
  InlineTokenDecorator,
  InlineTokenHandler,
} from "../fragment/inline.ts";
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
    kind: "decorate";
    token: InlineKind;
    apply: InlineTokenDecorator;
  }
  | {
    kind: "leaf";
    token: InlineKind;
    build: InlineLeafBuilder;
  }
  | {
    kind: "container";
    isolateDelimiters?: boolean;
    close: InlineKind;
    contentOpen: InlineKind;
    token: InlineKind;
    build: InlineNodeBuilder;
  }
  | {
    kind: "pair";
    isolateDelimiters?: boolean;
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
  tokenHandlers: readonly (InlineTokenHandler | undefined)[];
  tokenize: InlineTokenizer;
}

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

  const tokenHandlers: (InlineTokenHandler | undefined)[] = [];
  const containerByKind: (InlineContainer | undefined)[] = [];
  const pairByOpenKind: (InlinePair | undefined)[] = [];

  for (const definition of syntaxDefinitions) {
    if (definition.kind === "decorate") {
      tokenHandlers[definition.token] = definition.apply;
      continue;
    }
    if (definition.kind === "leaf") {
      tokenHandlers[definition.token] = definition.build;
      continue;
    }

    if (definition.kind === "container") {
      containerByKind[definition.token] = {
        closeKind: definition.close,
        contentOpenKind: definition.contentOpen,
        build: definition.build,
      };
    }
    else {
      pairByOpenKind[definition.open] = {
        closeKind: definition.close,
        build: definition.build,
      };
    }

    if (definition.isolateDelimiters) {
      pairs.push({
        opener: definition.kind === "container" ? definition.contentOpen : definition.open,
        closer: definition.close,
        isolateDelimiters: true,
      });
    }
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
    tokenHandlers,
    tokenize: compileInlineTokenizer(lexicalRules),
  };
}
