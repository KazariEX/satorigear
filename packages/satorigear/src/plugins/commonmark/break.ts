import {
  appendInline,
  blockEnd,
  type BlockProjector,
  firstNonspace,
  type InlineLeafProjector,
  withSpan,
} from "../../mdast.ts";

export const projectThematicBreak: BlockProjector = (nodeId, offset, _tokenBase, context) => {
  const end = offset + context.view.arena.lenOf(nodeId);
  return withSpan(
    { type: "thematicBreak" },
    firstNonspace(context.source, offset, end),
    blockEnd(nodeId, offset, context),
  );
};

export const projectInlineBreak: InlineLeafProjector = (_tokenIndex, sourceSpan, accumulator) => {
  appendInline(accumulator, withSpan({ type: "break" }, sourceSpan.start, sourceSpan.end), sourceSpan.start);
  return true;
};

export const projectInlineNewline: InlineLeafProjector = (_tokenIndex, sourceSpan, accumulator) => {
  appendInline(
    accumulator,
    withSpan({ type: "text", value: "\n" }, sourceSpan.start, sourceSpan.end),
    sourceSpan.start,
  );
  return true;
};
