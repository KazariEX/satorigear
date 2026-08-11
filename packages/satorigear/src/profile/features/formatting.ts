import type { Delete, Emphasis, PhrasingContent, Strong } from "mdast";
import {
  appendInline,
  contentBounds,
  createInlineAccumulator,
  type InlineRuleProjector,
  inlineSequence,
  withSpan,
} from "../../mdast.ts";
import { projectInlineText } from "./text.ts";
import type { DelimiterConfig } from "../../inline/pairing.ts";
import type { InlineSyntaxDefinition } from "../../inline/profile.ts";
import type { SyntaxFeature } from "../types.ts";

const asteriskDelimiter: DelimiterConfig = {
  token: "AsteriskRun",
  marker: "*",
  fallbackToken: "Delimiter",
  single: { open: "EmphasisOpen", close: "EmphasisClose" },
  double: { open: "StrongOpen", close: "StrongClose" },
  pairing: { kind: "partial", ruleOfThree: true },
};

const underscoreDelimiter: DelimiterConfig = {
  token: "UnderscoreRun",
  marker: "_",
  fallbackToken: "Delimiter",
  single: { open: "EmphasisOpen", close: "EmphasisClose" },
  double: { open: "StrongOpen", close: "StrongClose" },
  pairing: { kind: "partial", ruleOfThree: true },
  allowIntraword: false,
};

const strikethroughDelimiter: DelimiterConfig = {
  token: "TildeRun",
  marker: "~",
  fallbackToken: "Delimiter",
  double: { open: "StrongOpen", close: "StrongClose" },
  pairing: { kind: "whole" },
};

export interface StrikethroughOptions {
  singleTilde?: boolean;
}

type Formatting = Delete | Emphasis | Strong;

function projectFormatting(type: Formatting["type"], boundary: "Emphasis" | "Strong"): InlineRuleProjector {
  const open = `${boundary}Open`;
  const close = `${boundary}Close`;
  return (nodeId, offset, tokenBase, endOffset, sourceSpan, accumulator) => {
    const context = accumulator.context;
    const [start, end] = contentBounds(nodeId, tokenBase, open, close, context);
    const children: PhrasingContent[] = [];
    inlineSequence(nodeId, offset, tokenBase, createInlineAccumulator(context, children), start, end);
    appendInline(
      accumulator,
      withSpan<Formatting>({ type, children }, sourceSpan.start, sourceSpan.end),
    );
    return true;
  };
}

const projectInlineEmphasis = projectFormatting("emphasis", "Emphasis");
const projectInlineStrong = projectFormatting("strong", "Strong");
const projectInlineDelete = projectFormatting("delete", "Strong");

const projectInlineStrongOrDelete: InlineRuleProjector = (
  nodeId,
  offset,
  tokenBase,
  endOffset,
  sourceSpan,
  accumulator,
) => {
  const project = accumulator.context.source[sourceSpan.start] === "~"
    ? projectInlineDelete
    : projectInlineStrong;
  return project(nodeId, offset, tokenBase, endOffset, sourceSpan, accumulator);
};

const inlineSyntax: readonly InlineSyntaxDefinition[] = [
  { kind: "leaf", token: "Delimiter", project: projectInlineText },
  { kind: "leaf", token: "TildeRun", project: projectInlineText },
];

export function feature(strikethroughOptions?: boolean | StrikethroughOptions): SyntaxFeature {
  const delimiters = [asteriskDelimiter, underscoreDelimiter];
  if (strikethroughOptions) {
    delimiters.push(
      typeof strikethroughOptions !== "object" || strikethroughOptions.singleTilde !== false
        ? { ...strikethroughDelimiter, single: strikethroughDelimiter.double }
        : strikethroughDelimiter,
    );
  }

  // Reuse the double-delimiter structure so enabling `~` does not add another semantic rule.
  const projectStrong = strikethroughOptions ? projectInlineStrongOrDelete : projectInlineStrong;

  return {
    inline: {
      resolution: { delimiters },
      syntax: [
        ...inlineSyntax,
        {
          kind: "pair",
          open: "EmphasisOpen",
          close: "EmphasisClose",
          rule: "Emphasis",
          linkRule: "LinkEmphasis",
          project: projectInlineEmphasis,
        },
        {
          kind: "pair",
          open: "StrongOpen",
          close: "StrongClose",
          rule: "Strong",
          linkRule: "LinkStrong",
          project: projectStrong,
        },
      ],
    },
  };
}
