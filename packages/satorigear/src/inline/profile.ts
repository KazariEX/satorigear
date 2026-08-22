import { createDelimiterResolver, type DelimiterConfig } from "./delimiter.ts";
import { compileInlineTokenizer, type InlineScanRule, type InlineTokenizer } from "./lexer.ts";
import type { InlineKind } from "../constants/inline.ts";
import type {
  InlineLeafBuilder,
  InlineNodeBuilder,
  InlineTokenDecorator,
  InlineTokenHandler,
} from "../fragment/inline.ts";
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

export type InlineBuildRule =
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

export interface InlineFeature {
  /** Recognize source ranges and append raw inline tokens. */
  scan?: readonly InlineScanRule[];
  /** Resolve token relationships before semantic builders consume them. */
  resolve?: {
    delimiters?: readonly DelimiterConfig[];
    transform?: InlineTokenTransform;
  };
  /** Build semantic nodes from the resolved token stream. */
  build?: readonly InlineBuildRule[];
}

export interface InlineProfile {
  resolve: InlineTokenTransform;
  schema: InlineSyntaxSchema;
  tokenHandlers: readonly (InlineTokenHandler | undefined)[];
  tokenize: InlineTokenizer;
}

function composeTransforms(transforms: readonly InlineTokenTransform[]): InlineTokenTransform {
  if (transforms.length === 1) {
    return transforms[0];
  }
  return (source, tokens, context) => {
    for (const transform of transforms) {
      tokens = transform(source, tokens, context);
    }
    return tokens;
  };
}

export function compileInlineProfile(features: readonly InlineFeature[]): InlineProfile {
  const delimiters: DelimiterConfig[] = [];
  const scanRules: InlineScanRule[] = [];
  const transforms: InlineTokenTransform[] = [];
  const tokenHandlers: (InlineTokenHandler | undefined)[] = [];
  const containerByKind: (InlineContainer | undefined)[] = [];
  const pairByOpenKind: (InlinePair | undefined)[] = [];
  const isolationCloseByOpen: (number | undefined)[] = [];

  for (const feature of features) {
    const resolve = feature.resolve;
    if (feature.scan) {
      scanRules.push(...feature.scan);
    }
    if (resolve?.delimiters) {
      delimiters.push(...resolve.delimiters);
    }
    if (resolve?.transform) {
      transforms.push(resolve.transform);
    }
    const build = feature.build;
    if (!build) {
      continue;
    }
    for (const rule of build) {
      if (rule.kind === "decorate") {
        tokenHandlers[rule.token] = rule.apply;
        continue;
      }
      if (rule.kind === "leaf") {
        tokenHandlers[rule.token] = rule.build;
        continue;
      }

      if (rule.kind === "container") {
        // Semantic container boundaries also delimit formatting; derive that fact from the builder shape.
        isolationCloseByOpen[rule.contentOpen] = rule.close;
        containerByKind[rule.token] = {
          closeKind: rule.close,
          contentOpenKind: rule.contentOpen,
          build: rule.build,
        };
      }
      else {
        isolationCloseByOpen[rule.open] = rule.close;
        pairByOpenKind[rule.open] = {
          closeKind: rule.close,
          build: rule.build,
        };
      }
    }
  }

  const resolveDelimiters = createDelimiterResolver(delimiters, isolationCloseByOpen);
  const transform = transforms.length ? composeTransforms(transforms) : void 0;

  return {
    resolve: transform === void 0
      ? resolveDelimiters
      : (source, tokens, context) => {
        const transformed = transform(source, tokens, context);
        return resolveDelimiters(source, transformed);
      },
    schema: {
      containerByKind,
      pairByOpenKind,
    },
    tokenHandlers,
    tokenize: compileInlineTokenizer(scanRules),
  };
}
