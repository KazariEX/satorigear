import { compileInlineTokenizer, type InlineScanRule, type InlineTokenizer } from "./lexer.ts";
import type { InlineKind } from "../constants/inline.ts";
import type {
  InlineLeafBuilder,
  InlineNodeBuilder,
  InlineTokenDecorator,
  InlineTokenHandler,
} from "../fragment/inline.ts";
import type { DelimiterConfig } from "./delimiter.ts";
// Inline features compile into one token pipeline and the projection tables that consume it.
import type { InlineTokenStream } from "./tokens.ts";

export interface InlineResolutionContext {
  hasDefinition: (key: string) => boolean;
}

type InlineResolver = (
  source: string,
  tokens: InlineTokenStream,
  context: InlineResolutionContext,
) => InlineTokenStream;

export type InlineResolverCompiler = (
  delimiters: readonly DelimiterConfig[],
) => InlineResolver;

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
  /** Participate in compiled delimiter pairing. */
  delimiters?: readonly DelimiterConfig[];
  /** Build semantic nodes from the resolved token stream. */
  build?: readonly InlineBuildRule[];
}

export interface InlineProfile {
  resolve: InlineResolver;
  schema: InlineSyntaxSchema;
  tokenHandlers: readonly (InlineTokenHandler | undefined)[];
  tokenize: InlineTokenizer;
}

export function compileInlineProfile(
  features: readonly InlineFeature[],
  compileResolver: InlineResolverCompiler,
): InlineProfile {
  const delimiters: DelimiterConfig[] = [];
  const scanRules: InlineScanRule[] = [];
  const tokenHandlers: (InlineTokenHandler | undefined)[] = [];
  const containerByKind: (InlineContainer | undefined)[] = [];
  const pairByOpenKind: (InlinePair | undefined)[] = [];

  for (const feature of features) {
    if (feature.scan) {
      scanRules.push(...feature.scan);
    }
    if (feature.delimiters) {
      delimiters.push(...feature.delimiters);
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
  }

  return {
    resolve: compileResolver(delimiters),
    schema: {
      containerByKind,
      pairByOpenKind,
    },
    tokenHandlers,
    tokenize: compileInlineTokenizer(scanRules),
  };
}
