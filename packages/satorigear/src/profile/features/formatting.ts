import type { Delete, Emphasis, PhrasingContent, Strong } from "mdast";
import {
  appendInline,
  appendInlineSequence,
  contentBounds,
  createInlineAccumulator,
  type InlineNodeBuilder,
} from "../../fragment/inline.ts";
import { buildInlineText } from "./text.ts";
import type { SpannedNode } from "../../fragment/node.ts";
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

function createBuildFormatting(type: Formatting["type"], boundary: "Emphasis" | "Strong"): InlineNodeBuilder {
  const open = `${boundary}Open`;
  const close = `${boundary}Close`;
  return (nodeId, offset, endOffset, sourceSpan, accumulator) => {
    const context = accumulator.context;
    const [start, end] = contentBounds(nodeId, open, close, context);
    const children: SpannedNode<PhrasingContent>[] = [];
    appendInlineSequence(nodeId, offset, createInlineAccumulator(context, children), start, end);
    appendInline(accumulator, { type, children, position: sourceSpan });
    return true;
  };
}

const buildInlineEmphasis = createBuildFormatting("emphasis", "Emphasis");
const buildInlineStrong = createBuildFormatting("strong", "Strong");
const buildInlineDelete = createBuildFormatting("delete", "Strong");

const buildInlineStrongOrDelete: InlineNodeBuilder = (
  nodeId,
  offset,
  endOffset,
  sourceSpan,
  accumulator,
) => {
  const build = accumulator.context.source[sourceSpan.start] === "~"
    ? buildInlineDelete
    : buildInlineStrong;
  return build(nodeId, offset, endOffset, sourceSpan, accumulator);
};

const inlineSyntax: readonly InlineSyntaxDefinition[] = [
  { kind: "leaf", token: "Delimiter", build: buildInlineText },
  { kind: "leaf", token: "TildeRun", build: buildInlineText },
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
  const buildStrong = strikethroughOptions ? buildInlineStrongOrDelete : buildInlineStrong;

  return {
    inline: {
      resolution: { delimiters },
      syntax: [
        ...inlineSyntax,
        {
          kind: "pair",
          open: "EmphasisOpen",
          close: "EmphasisClose",
          build: buildInlineEmphasis,
        },
        {
          kind: "pair",
          open: "StrongOpen",
          close: "StrongClose",
          build: buildStrong,
        },
      ],
    },
  };
}
