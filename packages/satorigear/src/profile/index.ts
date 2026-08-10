import {
  createDelimitedTokenResolver,
  type DelimiterRunConfig,
  type PairedTokenConfig,
} from "../inline/resolver.ts";
import { inlineKind } from "../inline/runtime.ts";
import {
  feature as featureAttributes,
  transformInlineAttributes,
} from "./features/attributes/index.ts";
import { feature as featureBlockQuote } from "./features/blockquote.ts";
import { feature as featureBreak } from "./features/break.ts";
import { feature as featureCode } from "./features/code.ts";
import { feature as featureComponent } from "./features/component/index.ts";
import { transformInlineCarrier } from "./features/component/inline.ts";
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
import { feature as featureTable } from "./features/table.ts";
import { feature as featureText, semanticText } from "./features/text.ts";
import type { BlockToken } from "../block/tokens.ts";
import type { BlockProjector, InlineLeafProjector, InlineRuleProjector } from "../mdast.ts";
import type {
  BlockDecoratorRegistration,
  BlockInterruptDispatch,
  BlockLineUnwrapper,
  BlockRestart,
  BlockStart,
  BlockStartDispatch,
  InlineResolutionContext,
  InlineTransform,
  SyntaxFeature,
  SyntaxProfile,
} from "./types.ts";

const leadingFeatures = [
  featureHeading,
  featureBreak,
  featureBlockQuote,
  featureList,
  featureCode,
  featureHtml,
  featureReference,
];

const trailingFeatures = [
  featureParagraph,
  featureText,
  featureEmphasis,
  featureLink,
];

export interface SyntaxOptions {
  attributes?: boolean;
  component?: boolean;
  frontmatter?: boolean | FrontmatterOptions;
  table?: boolean;
}

// Canonical option keys make equivalent option objects share one immutable profile.
const profiles = Object.create(null);
const defaultOptions: SyntaxOptions = {};

function profileKey(options: SyntaxOptions): number {
  let key = 0;

  if (options.attributes) {
    key |= 1 << 0;
  }
  if (options.component) {
    key |= 1 << 1;
  }
  if (options.frontmatter) {
    if (typeof options.frontmatter === "object" && options.frontmatter.marker === "+") {
      key |= 1 << 2;
    }
    else {
      key |= 1 << 3;
    }
  }
  if (options.table) {
    key |= 1 << 4;
  }
  return key;
}

export function createProfile(options: SyntaxOptions = defaultOptions): SyntaxProfile {
  const key = options === defaultOptions ? 0 : profileKey(options);
  if (key in profiles) {
    return profiles[key];
  }

  const component = Boolean(options.component);
  const attributes = Boolean(options.attributes);
  const features = [...leadingFeatures];

  if (options.frontmatter) {
    features.unshift(
      frontmatterFeature(
        typeof options.frontmatter === "object"
          ? options.frontmatter.marker
          : "-",
      ),
    );
  }
  if (options.table) {
    // A delimiter promotes the preceding paragraph line, so tables must run before the paragraph fallback.
    features.push(featureTable);
  }

  features.push(...trailingFeatures);

  if (component) {
    features.push(featureComponent);
  }
  if (attributes) {
    features.push(featureAttributes);
  }

  const inlineCarrier: InlineTransform | undefined = component || attributes
    ? (source, tokens) => {
      const carried = component ? transformInlineCarrier(source, tokens) : tokens;
      return attributes ? transformInlineAttributes(source, carried) : carried;
    }
    : void 0;

  profiles[key] = compileProfile(features, inlineCarrier);
  return profiles[key];
}

// Compilation builds the hot dispatch tables once; documents only retain the immutable result.
function compileProfile(features: readonly SyntaxFeature[], transformInline?: InlineTransform): SyntaxProfile {
  const blockDecorators: BlockDecoratorRegistration[] = [];
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
    if (feature.blockDecorators) {
      blockDecorators.push(...feature.blockDecorators);
    }
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
        if (registration.project) {
          blockProjects[registration.rule] = registration.project;
        }
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

  for (const registration of blockDecorators) {
    const project = blockProjects[registration.rule];
    if (!project) {
      throw new Error(`Cannot decorate unknown block rule ${registration.rule}`);
    }
    blockProjects[registration.rule] = registration.decorate(project);
  }

  const resolver = createDelimitedTokenResolver(delimiterRuns, tokenPairs);
  // Generated lexer tokens become optional syntax carriers before reference and delimiter resolution.
  const resolveInline: SyntaxProfile["resolveInline"] = transformInline === void 0
    ? (source, tokens, state) => resolver.resolve(
      source,
      reassociateReferenceTails(source, tokens, state),
      state,
    )
    : (source, tokens, state) => resolver.resolve(
      source,
      reassociateReferenceTails(source, transformInline(source, tokens, state), state),
      state,
    );

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
    resolveInline,
  };
}
