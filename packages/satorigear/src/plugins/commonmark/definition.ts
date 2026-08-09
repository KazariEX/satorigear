import type { Definition } from "mdast";
import { linkDefinitionFields } from "../../block/tokens.ts";
import { blockEnd, type BlockProjector, blockToken, withSpan } from "../../mdast.ts";
import { semanticText } from "./text.ts";

export const projectLinkDefinition: BlockProjector = (nodeId, offset, tokenBase, context): Definition => {
  const token = blockToken(nodeId, tokenBase, "LinkDefinitionOpen", context);
  const fields = linkDefinitionFields(token);
  return withSpan({
    type: "definition",
    identifier: fields.normalizedLabel.toLowerCase(),
    label: semanticText(fields.label),
    url: semanticText(fields.destination),
    title: fields.title === null ? null : semanticText(fields.title),
  }, token.offset + fields.markerOffset, blockEnd(nodeId, offset, context));
};
