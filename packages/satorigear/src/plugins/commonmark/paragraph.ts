import type { Paragraph } from "mdast";
import { blockEnd, type BlockProjector, firstChildStart, inlineChildren, withSpan } from "../../mdast.ts";

export const projectParagraph: BlockProjector = (nodeId, offset, _tokenBase, context) => {
  const result = { type: "paragraph", children: inlineChildren(nodeId, context) } satisfies Paragraph;
  return withSpan(result, firstChildStart(result), blockEnd(nodeId, offset, context));
};
