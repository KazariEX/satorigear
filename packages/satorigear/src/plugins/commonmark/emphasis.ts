import type { Emphasis, PhrasingContent, Strong } from "mdast";
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
import type { DelimiterRunConfig } from "../../inline/resolver.ts";
import type { InternalSyntaxPlugin } from "../plugin.ts";

const markdownDelimiterRuns: DelimiterRunConfig[] = [
  {
    token: "AsteriskRun",
    marker: "*",
    fallbackToken: "Delimiter",
    single: { open: "EmphasisOpen", close: "EmphasisClose" },
    double: { open: "StrongOpen", close: "StrongClose" },
    ruleOfThree: true,
  },
  {
    token: "UnderscoreRun",
    marker: "_",
    fallbackToken: "Delimiter",
    single: { open: "EmphasisOpen", close: "EmphasisClose" },
    double: { open: "StrongOpen", close: "StrongClose" },
    intraword: false,
    ruleOfThree: true,
  },
];

const projectInlineEmphasis: InlineRuleProjector = (
  nodeId,
  offset,
  _endOffset,
  tokenBase,
  sourceSpan,
  accumulator,
) => {
  const context = accumulator.context;
  const [start, end] = contentBounds(nodeId, tokenBase, ["EmphasisOpen"], ["EmphasisClose"], context);
  const children: PhrasingContent[] = [];
  inlineSequence(nodeId, offset, tokenBase, createInlineAccumulator(context, children), start, end);
  appendInline(
    accumulator,
    withSpan({ type: "emphasis", children } satisfies Emphasis, sourceSpan.start, sourceSpan.end),
    sourceSpan.start,
  );
  return true;
};

const projectInlineStrong: InlineRuleProjector = (
  nodeId,
  offset,
  _endOffset,
  tokenBase,
  sourceSpan,
  accumulator,
) => {
  const context = accumulator.context;
  const [start, end] = contentBounds(nodeId, tokenBase, ["StrongOpen"], ["StrongClose"], context);
  const children: PhrasingContent[] = [];
  inlineSequence(nodeId, offset, tokenBase, createInlineAccumulator(context, children), start, end);
  appendInline(
    accumulator,
    withSpan({ type: "strong", children } satisfies Strong, sourceSpan.start, sourceSpan.end),
    sourceSpan.start,
  );
  return true;
};

export const emphasisPlugin: InternalSyntaxPlugin = {
  delimiterRuns: markdownDelimiterRuns,
  inlineRules: [
    { rule: "Emphasis", project: projectInlineEmphasis },
    { rule: "LinkEmphasis", project: projectInlineEmphasis },
    { rule: "Strong", project: projectInlineStrong },
    { rule: "LinkStrong", project: projectInlineStrong },
  ],
  inlineTokens: [
    { token: "Delimiter", project: projectInlineText },
    { token: "Strikethrough", project: projectInlineText },
    { token: "EmphasisOpen", project: projectInlineIgnore },
    { token: "EmphasisClose", project: projectInlineIgnore },
    { token: "StrongOpen", project: projectInlineIgnore },
    { token: "StrongClose", project: projectInlineIgnore },
  ],
};
