import {
  createPairingResolver,
  type DelimiterConfig,
  type PairedTokenConfig,
} from "../inline/pairing.ts";
import { compileInlineSyntax, type InlineStructureRegistration } from "../inline/syntax.ts";
import { inlineKind } from "../inline/tokens.ts";
import { feature as featureAttributes } from "./features/attributes/index.ts";
import { feature as featureBlockQuote } from "./features/blockquote.ts";
import { feature as featureBreak } from "./features/break.ts";
import { feature as featureCode } from "./features/code.ts";
import { feature as featureComponent } from "./features/component/index.ts";
import { feature as featureFootnote } from "./features/footnote/index.ts";
import { feature as featureFormatting, type StrikethroughOptions } from "./features/formatting.ts";
import { feature as frontmatterFeature, type FrontmatterOptions } from "./features/frontmatter.ts";
import { feature as featureHeading } from "./features/heading.ts";
import { feature as featureHtml } from "./features/html.ts";
import { feature as featureLink } from "./features/link.ts";
import { feature as featureList } from "./features/list.ts";
import { feature as featureMath } from "./features/math/index.ts";
import { feature as featureParagraph } from "./features/paragraph.ts";
import { feature as featureReference } from "./features/reference.ts";
import { feature as featureTable } from "./features/table.ts";
import { feature as featureText, semanticText } from "./features/text.ts";
import type { BlockSyntaxFrame, BlockSyntaxSchema } from "../block/syntax.ts";
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
  SyntaxProfile,
} from "./types.ts";

export interface SyntaxOptions {
  attributes?: boolean;
  component?: boolean;
  footnote?: boolean;
  frontmatter?: boolean | FrontmatterOptions;
  math?: boolean | MathOptions;
  strikethrough?: boolean | StrikethroughOptions;
  table?: boolean;
}

function composeInlineTransforms(...transforms: readonly InlineTransform[]): InlineTransform | undefined {
  if (transforms.length === 0) {
    return;
  }
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

// Compilation builds the hot dispatch tables once; documents only retain the immutable result.
export function compileProfile(options: SyntaxOptions = {}): SyntaxProfile {
  const features = [
    featureHeading,
    featureBreak,
    featureBlockQuote,
    featureList,
    featureCode,
    featureHtml,
  ];

  if (options.footnote) {
    features.push(featureFootnote);
  }

  features.push(featureReference);

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
    features.push(featureMath(options.math));
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

  const blockDecorators: BlockDecoratorRegistration[] = [];
  const blockFallbacks: BlockStart[] = [];
  const blockInlineContents: Record<string, true> = Object.create(null);
  const blockFrameByOpen: Record<string, BlockSyntaxFrame> = Object.create(null);
  const blockGroupedRuleByToken: Record<string, string> = Object.create(null);
  const blockInterrupts: (BlockInterruptDispatch | undefined)[] = [];
  const blockRuleByLeaf: Record<string, string> = Object.create(null);
  const blockProjects: Record<string, BlockProjector> = Object.create(null);
  const blockDefinitionKeys: Record<string, (token: BlockToken) => string> = Object.create(null);
  const blockRestarts: BlockRestart[] = [];
  const blockStarts: (BlockStartDispatch | undefined)[] = [];
  const blockUnwrappers: BlockLineUnwrapper[] = [];
  const delimiters: DelimiterConfig[] = [];
  const inlineNormalizes: InlineTransform[] = [];
  const inlineRuleProjects: Record<string, InlineRuleProjector> = Object.create(null);
  const inlineStructures: InlineStructureRegistration[] = [];
  const inlineTokenNames: (string | undefined)[] = [];
  const inlineTokenProjects: (InlineLeafProjector | undefined)[] = [];
  const inlineTransforms: InlineTransform[] = [];
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
        const syntax = registration.syntax;
        if (syntax?.kind === "frame") {
          const opens = typeof syntax.open === "string" ? [syntax.open] : syntax.open;
          for (const open of opens) {
            blockFrameByOpen[open] = {
              close: syntax.close,
              rule: registration.rule,
              wrapsBlock: syntax.topLevel,
            };
          }
        }
        else if (syntax?.kind === "group") {
          for (const token of syntax.tokens) {
            blockGroupedRuleByToken[token] = registration.rule;
          }
        }
        else if (syntax?.kind === "leaf") {
          blockRuleByLeaf[syntax.token] = registration.rule;
        }
        if (registration.project) {
          blockProjects[registration.rule] = registration.project;
        }
        if (registration.inlineContent) {
          blockInlineContents[registration.rule] = true;
        }
        if (registration.definitionKey) {
          blockDefinitionKeys[registration.rule] = registration.definitionKey;
        }
      }
    }
    if (feature.blockUnwrappers) {
      blockUnwrappers.push(...feature.blockUnwrappers);
    }
    if (feature.delimiters) {
      delimiters.push(...feature.delimiters);
    }
    if (feature.inlineNormalize) {
      inlineNormalizes.push(feature.inlineNormalize);
    }
    if (feature.inlineRules) {
      for (const registration of feature.inlineRules) {
        inlineRuleProjects[registration.rule] = registration.project;
      }
    }
    if (feature.inlineStructures) {
      inlineStructures.push(...feature.inlineStructures);
    }
    if (feature.inlineTokens) {
      for (const registration of feature.inlineTokens) {
        const kind = inlineKind(registration.token);
        inlineTokenNames[kind] = registration.token;
        inlineTokenProjects[kind] = registration.project;
      }
    }
    if (feature.inlineTransform) {
      inlineTransforms.push(feature.inlineTransform);
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

  // Compile the registered stages into one path; documents never branch on enabled syntax.
  const resolver = createPairingResolver(delimiters, tokenPairs);
  const transformInline = composeInlineTransforms(...inlineTransforms, ...inlineNormalizes);
  const resolveInline: SyntaxProfile["resolveInline"] = transformInline
    ? (source, tokens, state) => resolver.resolve(
      source,
      transformInline(source, tokens, state),
      state,
    )
    : resolver.resolve;

  const blockSyntax: BlockSyntaxSchema = {
    entryRule: "Document",
    frameByOpen: blockFrameByOpen,
    groupedRuleByToken: blockGroupedRuleByToken,
    ruleByLeaf: blockRuleByLeaf,
    wrapperRule: "Block",
  };

  return {
    blockFallbacks,
    blockInlineContents,
    blockInterrupts,
    blockProjects,
    blockDefinitionKeys,
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
    blockSyntax,
    blockUnwrappers,
    decodeText: semanticText,
    inlineRuleProjects,
    inlineSyntax: compileInlineSyntax(inlineStructures, inlineTokenNames),
    inlineTokenProjects,
    resolveInline,
  };
}
