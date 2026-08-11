import type { Delete, Emphasis, PhrasingContent, Strong } from "mdast";
import {
  appendInline,
  contentBounds,
  createInlineAccumulator,
  type InlineRuleProjector,
  inlineSequence,
  projectInlineIgnore,
  withSpan,
} from "../../mdast.ts";
import { projectInlineText } from "./text.ts";
import type { DelimiterConfig } from "../../inline/pairing.ts";
import type { InlineFeature } from "../../inline/profile.ts";
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

const projectInlineEmphasis: InlineRuleProjector = (
  nodeId,
  offset,
  tokenBase,
  endOffset,
  sourceSpan,
  accumulator,
) => {
  const context = accumulator.context;
  const [start, end] = contentBounds(nodeId, tokenBase, ["EmphasisOpen"], ["EmphasisClose"], context);
  const children: PhrasingContent[] = [];
  inlineSequence(nodeId, offset, tokenBase, createInlineAccumulator(context, children), start, end);
  appendInline(
    accumulator,
    withSpan<Emphasis>({ type: "emphasis", children }, sourceSpan.start, sourceSpan.end),
  );
  return true;
};

const projectInlineStrong: InlineRuleProjector = (
  nodeId,
  offset,
  tokenBase,
  endOffset,
  sourceSpan,
  accumulator,
) => {
  const context = accumulator.context;
  const [start, end] = contentBounds(nodeId, tokenBase, ["StrongOpen"], ["StrongClose"], context);
  const children: PhrasingContent[] = [];
  inlineSequence(nodeId, offset, tokenBase, createInlineAccumulator(context, children), start, end);
  appendInline(
    accumulator,
    withSpan<Strong>({ type: "strong", children }, sourceSpan.start, sourceSpan.end),
  );
  return true;
};

const projectInlineDelete: InlineRuleProjector = (
  nodeId,
  offset,
  tokenBase,
  endOffset,
  sourceSpan,
  accumulator,
) => {
  const context = accumulator.context;
  const [start, end] = contentBounds(nodeId, tokenBase, ["StrongOpen"], ["StrongClose"], context);
  const children: PhrasingContent[] = [];
  inlineSequence(nodeId, offset, tokenBase, createInlineAccumulator(context, children), start, end);
  appendInline(
    accumulator,
    withSpan<Delete>({ type: "delete", children }, sourceSpan.start, sourceSpan.end),
  );
  return true;
};

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

const inlineTokens: InlineFeature["tokens"] = [
  { token: "Delimiter", project: projectInlineText },
  { token: "TildeRun", project: projectInlineText },
  { token: "EmphasisOpen", project: projectInlineIgnore },
  { token: "EmphasisClose", project: projectInlineIgnore },
  { token: "StrongOpen", project: projectInlineIgnore },
  { token: "StrongClose", project: projectInlineIgnore },
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
      delimiters,
      rules: [
        { rule: "Emphasis", project: projectInlineEmphasis },
        { rule: "LinkEmphasis", project: projectInlineEmphasis },
        { rule: "Strong", project: projectStrong },
        { rule: "LinkStrong", project: projectStrong },
      ],
      structures: [
        {
          kind: "pair",
          open: "EmphasisOpen",
          close: "EmphasisClose",
          rule: "Emphasis",
          linkRule: "LinkEmphasis",
        },
        {
          kind: "pair",
          open: "StrongOpen",
          close: "StrongClose",
          rule: "Strong",
          linkRule: "LinkStrong",
        },
      ],
      tokens: inlineTokens,
    },
  };
}
