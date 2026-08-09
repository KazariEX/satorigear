import {
  createDelimitedTokenResolver,
  type DelimiterRunConfig,
  type PairedTokenConfig,
} from "../inline/resolver.ts";
import { inlineKind } from "../inline/runtime.ts";
import { feature as featureBlockQuote } from "./features/blockquote.ts";
import { feature as featureBreak } from "./features/break.ts";
import { feature as featureCode } from "./features/code.ts";
import { feature as featureEmphasis } from "./features/emphasis.ts";
import { feature as frontmatterFeature, type FrontmatterOptions } from "./features/frontmatter.ts";
import { feature as featureHeading } from "./features/heading.ts";
import { feature as featureHtml } from "./features/html.ts";
import { feature as featureLink } from "./features/link.ts";
import { feature as featureList } from "./features/list.ts";
import { feature as featureParagraph } from "./features/paragraph.ts";
import {
  feature as featureReference,
  reassociateReferenceTails,
} from "./features/reference.ts";
import { feature as featureText, semanticText } from "./features/text.ts";
import type { BlockToken } from "../block/tokens.ts";
import type { BlockProjector, InlineLeafProjector, InlineRuleProjector } from "../mdast.ts";
import type {
  BlockInterruptDispatch,
  BlockLineUnwrapper,
  BlockRestart,
  BlockStart,
  BlockStartDispatch,
  InlineResolutionContext,
  SyntaxFeature,
  SyntaxProfile,
} from "./types.ts";

const defaultFeatures = [
  featureHeading,
  featureBreak,
  featureBlockQuote,
  featureList,
  featureCode,
  featureHtml,
  featureReference,
  featureParagraph,
  featureText,
  featureEmphasis,
  featureLink,
] as const;

export interface SyntaxOptions {
  frontmatter?: boolean | FrontmatterOptions;
}

// Canonical option keys make equivalent option objects share one immutable profile.
const profiles = Object.create(null);
const defaultOptions: SyntaxOptions = {};

export function createProfile(options: SyntaxOptions = defaultOptions): SyntaxProfile {
  const key = options === defaultOptions ? "{}" : JSON.stringify(options);
  if (key in profiles) {
    return profiles[key];
  }

  const features = [...defaultFeatures];

  if (options.frontmatter) {
    features.unshift(
      frontmatterFeature(
        typeof options.frontmatter === "object"
          ? options.frontmatter.marker
          : "-",
      ),
    );
  }

  profiles[key] = compileProfile(features);
  return profiles[key];
}

// Compilation builds the hot dispatch tables once; documents only retain the immutable result.
function compileProfile(features: readonly SyntaxFeature[]): SyntaxProfile {
  const blockFallbacks: BlockStart[] = [];
  const blockInlineContents: Record<string, true> = Object.create(null);
  const blockInterrupts: (BlockInterruptDispatch | undefined)[] = [];
  const blockProjects: Record<string, BlockProjector> = Object.create(null);
  const blockReferenceLabels: Record<string, (token: BlockToken) => string> = Object.create(null);
  const blockRestarts: BlockRestart[] = [];
  const blockStarts: (BlockStartDispatch | undefined)[] = [];
  const blockUnwrappers: BlockLineUnwrapper[] = [];
  const delimiterRuns: DelimiterRunConfig[] = [];
  const inlineRuleProjects: Record<string, InlineRuleProjector> = Object.create(null);
  const inlineTokenProjects: (InlineLeafProjector | undefined)[] = [];
  const tokenPairs: PairedTokenConfig<InlineResolutionContext>[] = [];
  for (const feature of features) {
    if (feature.blockFallbacks) {
      blockFallbacks.push(...feature.blockFallbacks);
    }
    if (feature.blockRestart) {
      blockRestarts.push(feature.blockRestart);
    }
    if (feature.blockStarts) {
      for (const registration of feature.blockStarts) {
        for (const code of registration.codes) {
          const starts = blockStarts[code];
          blockStarts[code] = starts === void 0
            ? registration.start
            : typeof starts === "function"
              ? [starts, registration.start]
              : [...starts, registration.start];
          if (registration.interrupt) {
            const interrupts = blockInterrupts[code];
            blockInterrupts[code] = interrupts === void 0
              ? registration.interrupt
              : typeof interrupts === "function"
                ? [interrupts, registration.interrupt]
                : [...interrupts, registration.interrupt];
          }
        }
      }
    }
    if (feature.blockRules) {
      for (const registration of feature.blockRules) {
        blockProjects[registration.rule] = registration.project;
        if (registration.inlineContent) {
          blockInlineContents[registration.rule] = true;
        }
        if (registration.referenceLabel) {
          blockReferenceLabels[registration.rule] = registration.referenceLabel;
        }
      }
    }
    if (feature.blockUnwrappers) {
      blockUnwrappers.push(...feature.blockUnwrappers);
    }
    if (feature.delimiterRuns) {
      delimiterRuns.push(...feature.delimiterRuns);
    }
    if (feature.inlineRules) {
      for (const registration of feature.inlineRules) {
        inlineRuleProjects[registration.rule] = registration.project;
      }
    }
    if (feature.inlineTokens) {
      for (const registration of feature.inlineTokens) {
        inlineTokenProjects[inlineKind(registration.token)] = registration.project;
      }
    }
    if (feature.tokenPairs) {
      tokenPairs.push(...feature.tokenPairs);
    }
  }

  const resolver = createDelimitedTokenResolver(delimiterRuns, tokenPairs);

  return {
    blockFallbacks,
    blockInlineContents,
    blockInterrupts,
    blockProjects,
    blockReferenceLabels,
    blockRestart(source, lines, changedStart, changedEnd) {
      let result: number | undefined;
      for (const restart of blockRestarts) {
        const candidate = restart(source, lines, changedStart, changedEnd);
        if (candidate !== void 0 && (result === void 0 || candidate < result)) {
          result = candidate;
        }
      }
      return result;
    },
    blockStarts,
    blockUnwrappers,
    decodeText: semanticText,
    inlineRuleProjects,
    inlineTokenProjects,
    resolveInline(source, tokens, state) {
      return resolver.resolve(
        source,
        reassociateReferenceTails(source, tokens, state),
        state,
      );
    },
  };
}
