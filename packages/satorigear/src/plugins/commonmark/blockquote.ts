import type { Blockquote } from "mdast";
import {
  blockChildren,
  blockEnd,
  type BlockProjector,
  blockToken,
  firstNonspace,
  lineEnd,
  tokenStart,
  withSpan,
} from "../../mdast.ts";

export const projectBlockQuote: BlockProjector = (nodeId, offset, tokenBase, context) => {
  const result = {
    type: "blockquote",
    children: blockChildren(nodeId, offset, tokenBase, context),
  } satisfies Blockquote;
  const marker = blockToken(nodeId, tokenBase, "BlockQuoteOpen", context);
  const start = firstNonspace(context.source, tokenStart(marker), lineEnd(context.source, offset));
  return withSpan(result, start, blockEnd(nodeId, offset, context));
};
