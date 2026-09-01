import type { Blockquote, List } from "mdast";
import { BlockKind } from "../../../constants/block.ts";
import type { BlockFeature } from "../../../block/profile.ts";

export const blockDecorators: BlockFeature["decorators"] = [
  {
    token: [
      BlockKind.UnorderedListOpen,
      BlockKind.OrderedListOpen,
    ],
    decorate(build) {
      return (tokenStart, context) => {
        const result = build(tokenStart, context) as List;
        if (!result.spread) {
          for (const item of result.children) {
            const paragraph = !item.spread && item.children.length === 1 && item.children[0].type === "paragraph"
              ? item.children[0]
              : void 0;
            if (paragraph?.attributes) {
              item.attributes = paragraph.attributes;
              delete paragraph.attributes;
            }
          }
        }
        return result;
      };
    },
  },
  {
    token: BlockKind.BlockQuoteOpen,
    decorate(build) {
      return (tokenStart, context) => {
        const result = build(tokenStart, context) as Blockquote;
        const paragraph = result.children.length === 1 && result.children[0].type === "paragraph"
          ? result.children[0]
          : void 0;
        if (paragraph?.attributes) {
          result.attributes = paragraph.attributes;
          delete paragraph.attributes;
        }
        return result;
      };
    },
  },
];
