import { compileInlineTokenizer, type InlineScanRule, type InlineTokenizer } from "./lexer.ts";
import type { DefinitionLookup } from "../block/tokens.ts";
import type { InlineKind } from "../constants/inline.ts";
import type {
  InlineBuilder,
  InlineLeafBuilder,
  InlineNodeBuilder,
  InlineTextBuilder,
  InlineTokenDecorator,
} from "../fragment/inline.ts";
import type { DelimiterConfig } from "./delimiter.ts";
// Inline features compile into one token pipeline and the projection tables that consume it.
import type { InlineTokenStream } from "./tokens.ts";

type InlineResolver = (
  source: string,
  tokens: InlineTokenStream,
  definitions: DefinitionLookup,
) => InlineTokenStream;

export type InlineResolverFactory = (
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
    kind: "text";
    token: InlineKind;
    build: InlineTextBuilder;
  }
  | {
    kind: "pair";
    token: InlineKind;
    build: InlineNodeBuilder;
  };

export interface InlineFeature {
  /** Recognize source ranges and append raw inline tokens. */
  scan?: readonly InlineScanRule[];
  /** Participate in compiled delimiter pairing. */
  delimiters?: readonly DelimiterConfig[];
  /** Build semantic nodes from the resolved token stream. */
  build?: readonly InlineBuildRule[];
}

export interface InlineProfile {
  buildByKind: readonly (InlineBuilder | undefined)[];
  resolve: InlineResolver;
  tokenize: InlineTokenizer;
}

export function compileInlineProfile(
  features: readonly InlineFeature[],
  compileInlineResolver: InlineResolverFactory,
): InlineProfile {
  const buildByKind: (InlineBuilder | undefined)[] = [];
  const delimiters: DelimiterConfig[] = [];
  const scanRules: InlineScanRule[] = [];

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
      switch (rule.kind) {
        case "decorate": {
          buildByKind[rule.token] = rule.apply;
          break;
        }
        case "leaf": {
          buildByKind[rule.token] = rule.build;
          break;
        }
        case "text": {
          buildByKind[rule.token] = rule.build;
          break;
        }
        case "pair": {
          buildByKind[rule.token] = rule.build;
          break;
        }
      }
    }
  }

  return {
    buildByKind,
    resolve: compileInlineResolver(delimiters),
    tokenize: compileInlineTokenizer(scanRules),
  };
}
