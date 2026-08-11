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
    linkRule?: string;
    rule: string;
    token: string;
    project: InlineRuleProjector;
  }
  | {
    kind: "fallback";
    rule: string;
    tokens: readonly string[];
    project: InlineRuleProjector;
  }
  | {
    kind: "pair";
    close: string;
    entersLink?: true;
    linkRule?: string;
    open: string;
    rule: string;
    project: InlineRuleProjector;
  };

interface InlinePair {
  closeKind: number;
  entersLink: boolean;
  linkRuleId: number;
  ruleId: number;
}

interface InlineContainer {
  closeKind: number;
  contentOpenKind: number;
  linkRuleId: number;
  ruleId: number;
}

export interface InlineSyntaxSchema {
  containerByKind: readonly (InlineContainer | undefined)[];
  fallbackRuleByKind: readonly (number | undefined)[];
  pairByOpenKind: readonly (InlinePair | undefined)[];
}

interface InlineSyntaxCompilation {
  ruleProjects: readonly (InlineRuleProjector | undefined)[];
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
  ruleProjects: readonly (InlineRuleProjector | undefined)[];
  schema: InlineSyntaxSchema;
  tokenize: InlineTokenizer;
  tokenProjects: readonly (InlineLeafProjector | undefined)[];
}

const ignoreInlineToken: InlineLeafProjector = () => false;

function compileInlineSyntax(
  definitions: readonly InlineSyntaxDefinition[],
): InlineSyntaxCompilation {
  const tokenProjects: (InlineLeafProjector | undefined)[] = [];
  const ruleProjects: (InlineRuleProjector | undefined)[] = [];
  const ruleIds = new Map<string, number>();
  const ruleId = (name: string): number => {
    let id = ruleIds.get(name);
    if (id === void 0) {
      id = ruleIds.size;
      ruleIds.set(name, id);
    }
    return id;
  };
  const containerByKind: (InlineContainer | undefined)[] = [];
  const fallbackRuleByKind: (number | undefined)[] = [];
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

    const definitionRuleId = ruleId(definition.rule);
    ruleProjects[definitionRuleId] = definition.project;
    if (definition.kind === "fallback") {
      for (const token of definition.tokens) {
        fallbackRuleByKind[inlineKind(token)] = definitionRuleId;
      }
      continue;
    }

    const linkRuleId = definition.linkRule === void 0
      ? definitionRuleId
      : ruleId(definition.linkRule);
    if (definition.linkRule !== void 0) {
      ruleProjects[linkRuleId] = definition.project;
    }
    if (definition.kind === "container") {
      const tokenKind = registerToken(definition.token, ignoreInlineToken);
      containerByKind[tokenKind] = {
        closeKind: registerToken(definition.close, ignoreInlineToken),
        contentOpenKind: registerToken(definition.contentOpen, ignoreInlineToken),
        linkRuleId,
        ruleId: definitionRuleId,
      };
      continue;
    }

    const openKind = registerToken(definition.open, ignoreInlineToken);
    pairByOpenKind[openKind] = {
      closeKind: registerToken(definition.close, ignoreInlineToken),
      entersLink: definition.entersLink === true,
      linkRuleId,
      ruleId: definitionRuleId,
    };
  }

  return {
    ruleProjects,
    schema: {
      containerByKind,
      fallbackRuleByKind,
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
