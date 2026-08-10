import {
  createDelimitedTokenResolver,
  type DelimiterConfig,
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
import { feature as featureFormatting, type StrikethroughOptions } from "./features/formatting.ts";
import { feature as frontmatterFeature, type FrontmatterOptions } from "./features/frontmatter.ts";
import { feature as featureHeading } from "./features/heading.ts";
import { feature as featureHtml } from "./features/html.ts";
import { feature as featureLink } from "./features/link.ts";
import { feature as featureList } from "./features/list.ts";
import { feature as featureMath } from "./features/math/index.ts";
import { transformInlineMath } from "./features/math/inline.ts";
import { feature as featureParagraph } from "./features/paragraph.ts";
import { feature as featureReference, reassociateReferenceTails } from "./features/reference.ts";
import { feature as featureTable } from "./features/table.ts";
import { feature as featureText, semanticText } from "./features/text.ts";
import type { BlockToken } from "../block/tokens.ts";
import type { BlockProjector, InlineLeafProjector, InlineRuleProjector } from "../mdast.ts";
import type { MathOptions } from "./features/math/types.ts";
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

export interface SyntaxOptions {
  attributes?: boolean;
  component?: boolean;
  frontmatter?: boolean | FrontmatterOptions;
  math?: boolean | MathOptions;
  strikethrough?: boolean | StrikethroughOptions;
  table?: boolean;
}

// Canonical option keys make equivalent option objects share one immutable profile.
const profiles = Object.create(null);
const defaultOptions: SyntaxOptions = {};

function createProfileKey(options: SyntaxOptions): number {
  let key = 0;

  if (options.attributes) {
    key |= 1 << 0;
  }
  if (options.component) {
    key |= 1 << 1;
  }
  if (options.frontmatter) {
    key |= 1 << (
      typeof options.frontmatter === "object" && options.frontmatter.marker === "+"
        ? 2
        : 3
    );
  }
  if (options.math) {
    key |= 1 << 4;
    if (typeof options.math === "object" && options.math.singleDollarTextMath === false) {
      key |= 1 << 5;
    }
  }
  if (options.strikethrough) {
    key |= 1 << 6;
    if (typeof options.strikethrough === "object" && options.strikethrough.singleTilde === false) {
      key |= 1 << 7;
    }
  }
  if (options.table) {
    key |= 1 << 8;
  }
  return key;
}

function createInlineTransform(options: SyntaxOptions): InlineTransform | undefined {
  const math = Boolean(options.math);
  const component = Boolean(options.component);
  const attributes = Boolean(options.attributes);
  if (!math && !component && !attributes) {
    return;
  }
  const singleDollarTextMath = typeof options.math !== "object" || options.math.singleDollarTextMath !== false;
  return (source, tokens) => {
    if (math) {
      tokens = transformInlineMath(source, tokens, singleDollarTextMath);
    }
    if (component) {
      tokens = transformInlineCarrier(source, tokens);
    }
    if (attributes) {
      tokens = transformInlineAttributes(source, tokens);
    }
    return tokens;
  };
}

export function createProfile(options: SyntaxOptions = defaultOptions): SyntaxProfile {
  const key = options === defaultOptions ? 0 : createProfileKey(options);
  if (key in profiles) {
    return profiles[key];
  }

  const features = [
    featureHeading,
    featureBreak,
    featureBlockQuote,
    featureList,
    featureCode,
    featureHtml,
    featureReference,
  ];

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
  if (options.math) {
    features.push(featureMath);
  }

  features.push(
    featureParagraph,
    featureText,
    featureFormatting(options.strikethrough),
    featureLink,
  );

  if (options.component) {
    features.push(featureComponent);
  }
  if (options.attributes) {
    features.push(featureAttributes);
  }

  // Compile one straight-line pipeline; the default profile keeps the resolver-only hot path.
  const inlineTransform = createInlineTransform(options);

  profiles[key] = compileProfile(features, inlineTransform);
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
  const delimiters: DelimiterConfig[] = [];
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
    if (feature.delimiters) {
      delimiters.push(...feature.delimiters);
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

  const resolver = createDelimitedTokenResolver(delimiters, tokenPairs);
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
