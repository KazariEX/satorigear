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

export type InlineTokenRewrite = (
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

export interface InlineFeature {
  delimiters?: readonly DelimiterConfig[];
  lexical?: readonly InlineLexicalRule[];
  pairs?: readonly PairedTokenConfig[];
  rewrite?: InlineTokenRewrite;
  syntax?: readonly InlineSyntaxDefinition[];
}

export interface InlineProfile {
  decodeText: (value: string) => string;
  resolve: InlineTokenRewrite;
  schema: InlineSyntaxSchema;
  tokenHandlers: readonly (InlineTokenHandler | undefined)[];
  tokenize: InlineTokenizer;
}

function composeRewrites(rewrites: readonly InlineTokenRewrite[]): InlineTokenRewrite {
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
  const rewrites: InlineTokenRewrite[] = [];

  for (const feature of features) {
    if (feature.delimiters) {
      delimiters.push(...feature.delimiters);
    }
    if (feature.lexical) {
      lexicalRules.push(...feature.lexical);
    }
    if (feature.pairs) {
      pairs.push(...feature.pairs);
    }
    if (feature.rewrite) {
      rewrites.push(feature.rewrite);
    }
    if (feature.syntax) {
      syntaxDefinitions.push(...feature.syntax);
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

  const pair = createPairingResolver(delimiters, pairs);
  const rewrite = rewrites.length === 0 ? void 0 : composeRewrites(rewrites);

  return {
    decodeText,
    resolve: rewrite === void 0
      ? pair
      : (source, tokens, context) => {
        const rewritten = rewrite(source, tokens, context);
        // A new stream is private to this resolution, so pairing may update kinds in place.
        return pair(source, rewritten, context, rewritten !== tokens);
      },
    schema: {
      containerByKind,
      pairByOpenKind,
    },
    tokenHandlers,
    tokenize: compileInlineTokenizer(lexicalRules),
  };
}
