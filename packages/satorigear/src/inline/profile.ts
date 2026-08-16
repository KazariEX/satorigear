import { compileInlineTokenizer, type InlineScanRule, type InlineTokenizer } from "./lexer.ts";
import { createPairingResolver, type DelimiterConfig, type PairedTokenConfig } from "./pairing.ts";
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
    pairs?: readonly PairedTokenConfig[];
    transform?: InlineTokenTransform;
  };
  /** Build semantic nodes from the resolved token stream. */
  build?: readonly InlineBuildRule[];
}

export interface InlineProfile {
  decodeText: (value: string) => string;
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

export function compileInlineProfile(
  features: readonly InlineFeature[],
  decodeText: (value: string) => string,
): InlineProfile {
  const delimiters: DelimiterConfig[] = [];
  const pairs: PairedTokenConfig[] = [];
  const scanRules: InlineScanRule[] = [];
  const transforms: InlineTokenTransform[] = [];
  const buildRules: InlineBuildRule[] = [];

  for (const feature of features) {
    const resolve = feature.resolve;
    if (feature.scan) {
      scanRules.push(...feature.scan);
    }
    if (resolve?.delimiters) {
      delimiters.push(...resolve.delimiters);
    }
    if (resolve?.pairs) {
      pairs.push(...resolve.pairs);
    }
    if (resolve?.transform) {
      transforms.push(resolve.transform);
    }
    if (feature.build) {
      buildRules.push(...feature.build);
    }
  }

  const tokenHandlers: (InlineTokenHandler | undefined)[] = [];
  const containerByKind: (InlineContainer | undefined)[] = [];
  const pairByOpenKind: (InlinePair | undefined)[] = [];

  for (const rule of buildRules) {
    if (rule.kind === "decorate") {
      tokenHandlers[rule.token] = rule.apply;
      continue;
    }
    if (rule.kind === "leaf") {
      tokenHandlers[rule.token] = rule.build;
      continue;
    }

    if (rule.kind === "container") {
      containerByKind[rule.token] = {
        closeKind: rule.close,
        contentOpenKind: rule.contentOpen,
        build: rule.build,
      };
    }
    else {
      pairByOpenKind[rule.open] = {
        closeKind: rule.close,
        build: rule.build,
      };
    }
  }

  const pair = createPairingResolver(delimiters, pairs);
  const transform = transforms.length ? composeTransforms(transforms) : void 0;

  return {
    decodeText,
    resolve: transform === void 0
      ? pair
      : (source, tokens, context) => {
        const transformed = transform(source, tokens, context);
        // A new stream is private to this resolution, so pairing may update kinds in place.
        return pair(source, transformed, context, transformed !== tokens);
      },
    schema: {
      containerByKind,
      pairByOpenKind,
    },
    tokenHandlers,
    tokenize: compileInlineTokenizer(scanRules),
  };
}
