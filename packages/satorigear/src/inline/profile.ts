import { compileInlineTokenizer, type InlineScanRule, type InlineTokenizer } from "./lexer.ts";
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

export interface InlineResolutionContext {
  hasDefinition: (key: string) => boolean;
}

type InlineResolver = (
  source: string,
  tokens: InlineTokenStream,
  context: InlineResolutionContext,
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
  decorateByKind: readonly boolean[];
  resolve: InlineResolver;
  // Semantic open kinds store [close, content-open] at kind * 2;
  // a missing close denotes a token handler, and zero content-open denotes a direct pair.
  syntaxByKind: readonly number[];
  textByKind: readonly boolean[];
  tokenize: InlineTokenizer;
}

export function compileInlineProfile(
  features: readonly InlineFeature[],
  compileInlineResolver: InlineResolverFactory,
): InlineProfile {
  const buildByKind: (InlineBuilder | undefined)[] = [];
  const decorateByKind: boolean[] = [];
  const delimiters: DelimiterConfig[] = [];
  const scanRules: InlineScanRule[] = [];
  const syntaxByKind: number[] = [];
  const textByKind: boolean[] = [];

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
          decorateByKind[rule.token] = true;
          break;
        }
        case "leaf": {
          buildByKind[rule.token] = rule.build;
          break;
        }
        case "text": {
          buildByKind[rule.token] = rule.build;
          textByKind[rule.token] = true;
          break;
        }
        case "container": {
          buildByKind[rule.token] = rule.build;
          syntaxByKind[rule.token * 2] = rule.close;
          syntaxByKind[rule.token * 2 + 1] = rule.contentOpen;
          break;
        }
        case "pair": {
          buildByKind[rule.open] = rule.build;
          syntaxByKind[rule.open * 2] = rule.close;
          syntaxByKind[rule.open * 2 + 1] = 0;
          break;
        }
      }
    }
  }

  return {
    buildByKind,
    decorateByKind,
    resolve: compileInlineResolver(delimiters),
    syntaxByKind,
    textByKind,
    tokenize: compileInlineTokenizer(scanRules),
  };
}
