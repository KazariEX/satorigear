import type { Heading } from "mdast";
import {
  blockEnd,
  type BlockProjector,
  blockToken,
  directBlockToken,
  firstChildStart,
  inlineChildren,
  tokenEnd,
  tokenStart,
  withSpan,
} from "../../mdast.ts";

export const projectAtxHeading: BlockProjector = (nodeId, offset, tokenBase, context) => {
  const marker = blockToken(nodeId, tokenBase, "AtxHeadingOpen", context);
  return withSpan({
    type: "heading",
    depth: tokenEnd(marker) - tokenStart(marker) as Heading["depth"],
    children: inlineChildren(nodeId, context, true),
  } satisfies Heading, tokenStart(marker), blockEnd(nodeId, offset, context));
};

export const projectSetextHeading: BlockProjector = (nodeId, _offset, tokenBase, context) => {
  const levelOne = directBlockToken(nodeId, tokenBase, "SetextHeading1Open", context);
  if (!levelOne) {
    blockToken(nodeId, tokenBase, "SetextHeading2Open", context);
  }
  const result = {
    type: "heading",
    depth: levelOne ? 1 : 2,
    children: inlineChildren(nodeId, context),
  } satisfies Heading;
  return withSpan(
    result,
    firstChildStart(result),
    tokenStart(blockToken(nodeId, tokenBase, "HeadingClose", context)),
  );
};
