import { inlineKind } from "./kinds.ts";
import { tokenizeInline } from "./lexer.ts";
import { createPairingResolver, type DelimiterConfig, type PairedTokenConfig } from "./pairing.ts";
import type { InlineLeafProjector, InlineRuleProjector } from "../mdast.ts";
// Inline features compile into one token pipeline and the arena/projection tables that consume it.
import type { InlineTokenStream } from "./tokens.ts";

type InlineTokenizer = (source: string) => InlineTokenStream;

export interface InlineResolutionContext {
  hasDefinition: (key: string) => boolean;
  tokenize: InlineTokenizer;
}

export type InlineTokenTransform = (
  source: string,
  tokens: InlineTokenStream,
  context: InlineResolutionContext,
) => InlineTokenStream;

export type InlineSyntaxDefinition =
  | {
    kind: "leaf";
    token: string;
    project: InlineLeafProjector;
  }
  | {
    kind: "container";
    close: string;
    contentOpen: string;
    token: string;
    project: InlineRuleProjector;
  }
  | {
    kind: "fallback";
    tokens: readonly string[];
    project: InlineRuleProjector;
  }
  | {
    kind: "pair";
    close: string;
    open: string;
    project: InlineRuleProjector;
  };

interface InlinePair {
  closeKind: number;
  project: InlineRuleProjector;
}

interface InlineContainer {
  closeKind: number;
  contentOpenKind: number;
  project: InlineRuleProjector;
}

export interface InlineSyntaxSchema {
  containerByKind: readonly (InlineContainer | undefined)[];
  fallbackProjectByKind: readonly (InlineRuleProjector | undefined)[];
  pairByOpenKind: readonly (InlinePair | undefined)[];
}

interface InlineSyntaxCompilation {
  schema: InlineSyntaxSchema;
  tokenProjects: readonly (InlineLeafProjector | undefined)[];
}

export interface InlineResolutionDefinition {
  delimiters?: readonly DelimiterConfig[];
  pairs?: readonly PairedTokenConfig[];
  postTransform?: InlineTokenTransform;
  transform?: InlineTokenTransform;
}

export interface InlineFeature {
  resolution?: InlineResolutionDefinition;
  syntax?: readonly InlineSyntaxDefinition[];
}

export interface InlineProfile {
  decodeText: (value: string) => string;
  resolve: InlineTokenTransform;
  schema: InlineSyntaxSchema;
  tokenize: InlineTokenizer;
  tokenProjects: readonly (InlineLeafProjector | undefined)[];
}

const ignoreInlineToken: InlineLeafProjector = () => false;

function compileInlineSyntax(
  definitions: readonly InlineSyntaxDefinition[],
): InlineSyntaxCompilation {
  const tokenProjects: (InlineLeafProjector | undefined)[] = [];
  const containerByKind: (InlineContainer | undefined)[] = [];
  const fallbackProjectByKind: (InlineRuleProjector | undefined)[] = [];
  const pairByOpenKind: (InlinePair | undefined)[] = [];
  const registerToken = (token: string, project: InlineLeafProjector): number => {
    const kind = inlineKind(token);
    tokenProjects[kind] = project;
    return kind;
  };

  for (const definition of definitions) {
    if (definition.kind === "leaf") {
      registerToken(definition.token, definition.project);
      continue;
    }

    if (definition.kind === "fallback") {
      for (const token of definition.tokens) {
        fallbackProjectByKind[inlineKind(token)] = definition.project;
      }
      continue;
    }

    if (definition.kind === "container") {
      const tokenKind = registerToken(definition.token, ignoreInlineToken);
      containerByKind[tokenKind] = {
        closeKind: registerToken(definition.close, ignoreInlineToken),
        contentOpenKind: registerToken(definition.contentOpen, ignoreInlineToken),
        project: definition.project,
      };
      continue;
    }

    const openKind = registerToken(definition.open, ignoreInlineToken);
    pairByOpenKind[openKind] = {
      closeKind: registerToken(definition.close, ignoreInlineToken),
      project: definition.project,
    };
  }

  return {
    schema: {
      containerByKind,
      fallbackProjectByKind,
      pairByOpenKind,
    },
    tokenProjects,
  };
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
  const syntax: InlineSyntaxDefinition[] = [];
  const pairs: PairedTokenConfig[] = [];
  const postTransforms: InlineTokenTransform[] = [];
  const transforms: InlineTokenTransform[] = [];

  for (const feature of features) {
    if (feature.syntax) {
      syntax.push(...feature.syntax);
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
  const compiledSyntax = compileInlineSyntax(syntax);

  return {
    ...compiledSyntax,
    decodeText,
    resolve: composeTransforms(
      ...transforms,
      ...postTransforms,
      createPairingResolver(delimiters, pairs),
    ),
    tokenize: tokenizeInline,
  };
}
