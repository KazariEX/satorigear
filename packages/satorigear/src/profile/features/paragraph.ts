import type { Paragraph } from "mdast";
import { indentOffset, trimLineWhitespaceStart } from "../../block/lines.ts";
import { BlockKind } from "../../constants/block.ts";
import { Character } from "../../constants/character.ts";
import { blockEnd } from "../../fragment/block.ts";
import { buildInlineFragment } from "../../fragment/inline.ts";
import { firstChildStart } from "../../fragment/node.ts";
import { setextMarkerAt } from "./heading.ts";
import type { SyntaxFeature } from "../types.ts";

export const feature: SyntaxFeature = {
  block: {
    fallbacks: [
      (source, lines, tokens, start, contentOffset, context) => {
        // Earlier fallbacks rejected this nonblank line, so it begins the paragraph.
        const openToken = tokens.length;
        const offset = lines.start(start);
        tokens.push(BlockKind.ParagraphOpen, offset, offset);
        // Keep one chunk across contiguous lines; split only where source has a gap.
        let chunkOffset = contentOffset;
        let index = start + 1;
        while (index < lines.length) {
          const lineEnd = lines.end(index);
          const contentStart = trimLineWhitespaceStart(source, lines.start(index), lineEnd);
          if (contentStart === lineEnd) {
            break;
          }
          const chunkStart = indentOffset(source, lines, index);
          const canInterrupt = !lines.lazy(index) && chunkStart === contentStart;
          if (canInterrupt) {
            const setext = setextMarkerAt(source, lines, index, contentStart);
            if (setext) {
              tokens.setKind(
                openToken,
                setext === Character.EqualsSign ? BlockKind.SetextHeading1Open : BlockKind.SetextHeading2Open,
              );
              tokens.setEnd(openToken, lineEnd);
              tokens.closeRange(chunkOffset, lines.end(index - 1));
              return index + 1;
            }
            if (context.startsInterruptingBlock(source, lines, index, contentStart)) {
              break;
            }
          }
          const previousEnd = lines.next(index - 1);
          if (chunkStart !== previousEnd) {
            tokens.push(BlockKind.InlineChunk, chunkOffset, previousEnd);
            chunkOffset = chunkStart;
          }
          index++;
        }
        const close = lines.end(index - 1);
        tokens.closeRange(chunkOffset, close);
        return index;
      },
    ],
    builds: [
      {
        token: BlockKind.ParagraphOpen,
        build(tokenStart, context) {
          const inline = buildInlineFragment(tokenStart, false, context);
          const result: Paragraph = {
            type: "paragraph",
            children: inline.children,
            position: {
              start: firstChildStart(inline.children),
              end: context.locator.locationAt(blockEnd(tokenStart, context)),
            },
          };
          if (inline.attributes) {
            result.attributes = inline.attributes;
          }
          return result;
        },
      },
    ],
  },
};
