import { blockEnd, type BlockProjector, firstNonspace, withSpan } from "../../mdast.ts";

export const projectThematicBreak: BlockProjector = (nodeId, offset, _tokenBase, context) => {
  const end = offset + context.view.arena.lenOf(nodeId);
  return withSpan(
    { type: "thematicBreak" },
    firstNonspace(context.source, offset, end),
    blockEnd(nodeId, offset, context),
  );
};
