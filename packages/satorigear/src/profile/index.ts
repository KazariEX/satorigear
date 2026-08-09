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
import { feature as featureHeading } from "./features/heading.ts";
import { feature as featureHtml } from "./features/html.ts";
import { feature as featureLink } from "./features/link.ts";
import { feature as featureList } from "./features/list.ts";
import { feature as featureParagraph } from "./features/paragraph.ts";
import {
  feature as featureReference,
  reassociateReferenceTails,
  restartBeforeReferenceChange,
} from "./features/reference.ts";
import { feature as featureText, semanticText } from "./features/text.ts";
import type { BlockToken } from "../block/tokens.ts";
import type { BlockProjector, InlineLeafProjector, InlineRuleProjector } from "../mdast.ts";
import type {
  BlockInterruptDispatch,
  BlockLineUnwrapper,
  BlockStart,
  BlockStartDispatch,
  InlineResolutionContext,
  InlineTransform,
  SyntaxFeature,
  SyntaxProfile,
} from "./types.ts";

// Compilation builds the hot dispatch tables once; documents only retain the immutable result.
function compileProfile(features: readonly SyntaxFeature[]): SyntaxProfile {
  const blockFallbacks: BlockStart[] = [];
  const blockInlineContents: Record<string, true> = Object.create(null);
  const blockInterrupts: (BlockInterruptDispatch | undefined)[] = [];
  const blockProjects: Record<string, BlockProjector> = Object.create(null);
  const blockReferenceLabels: Record<string, (token: BlockToken) => string> = Object.create(null);
  const blockStarts: (BlockStartDispatch | undefined)[] = [];
  const blockUnwrappers: BlockLineUnwrapper[] = [];
  const delimiterRuns: DelimiterRunConfig[] = [];
  const inlineRuleProjects: Record<string, InlineRuleProjector> = Object.create(null);
  const inlineTokenProjects: (InlineLeafProjector | undefined)[] = [];
  const tokenPairs: PairedTokenConfig<InlineResolutionContext>[] = [];
  for (const feature of features) {
    blockFallbacks.push(...feature.blockFallbacks ?? []);
    for (const registration of feature.blockStarts ?? []) {
      for (const code of registration.codes) {
        const starts = blockStarts[code];
        blockStarts[code] = !starts
          ? registration.start
          : typeof starts === "function"
            ? [starts, registration.start]
            : [...starts, registration.start];
        if (registration.interrupt) {
          const interrupts = blockInterrupts[code];
          blockInterrupts[code] = !interrupts
            ? registration.interrupt
            : typeof interrupts === "function"
              ? [interrupts, registration.interrupt]
              : [...interrupts, registration.interrupt];
        }
      }
    }
    for (const registration of feature.blockRules ?? []) {
      blockProjects[registration.rule] = registration.project;
      if (registration.inlineContent) {
        blockInlineContents[registration.rule] = true;
      }
      if (registration.referenceLabel) {
        blockReferenceLabels[registration.rule] = registration.referenceLabel;
      }
    }
    blockUnwrappers.push(...feature.blockUnwrappers ?? []);
    delimiterRuns.push(...feature.delimiterRuns ?? []);
    for (const registration of feature.inlineRules ?? []) {
      inlineRuleProjects[registration.rule] = registration.project;
    }
    for (const registration of feature.inlineTokens ?? []) {
      inlineTokenProjects[inlineKind(registration.token)] = registration.project;
    }
    tokenPairs.push(...feature.tokenPairs ?? []);
  }
  const resolver = createDelimitedTokenResolver(delimiterRuns, tokenPairs);
  const resolveInline: InlineTransform = (source, tokens, state) => resolver.resolve(
    source,
    reassociateReferenceTails(source, tokens, state),
    state,
  );
  return {
    blockFallbacks,
    blockInlineContents,
    blockInterrupts,
    blockProjects,
    blockReferenceLabels,
    blockRestart: restartBeforeReferenceChange,
    blockStarts,
    blockUnwrappers,
    decodeText: semanticText,
    inlineRuleProjects,
    inlineTokenProjects,
    resolveInline,
  };
}

export const commonmarkProfile = compileProfile([
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
]);
