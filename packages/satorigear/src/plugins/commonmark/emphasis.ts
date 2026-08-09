import type { Emphasis, PhrasingContent, Strong } from "mdast";
import {
  appendInline,
  contentBounds,
  createInlineAccumulator,
  type InlineRuleProjector,
  inlineSequence,
  withSpan,
} from "../../mdast.ts";

export const projectInlineEmphasis: InlineRuleProjector = (
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

export const projectInlineStrong: InlineRuleProjector = (
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
