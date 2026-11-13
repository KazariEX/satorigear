import type { Paragraph } from "mdast";
import { indentOffset, trimLineWhitespaceStart } from "../../block/lines.ts";
import { BlockKind, boundaryBreak } from "../../constants/block.ts";
import { Character } from "../../constants/character.ts";
import { buildInlineFragment } from "../../fragment/inline.ts";
import { setextMarkerAt } from "./heading.ts";
import type { SyntaxFeature } from "../types.ts";

export const feature: SyntaxFeature = {
  block: {
    fallbacks: [
      (source, lines, tokens, start, contentOffset, context) => {
        // Earlier fallbacks rejected this nonblank line, so it begins the paragraph.
        const openToken = tokens.length;
        tokens.push(BlockKind.ParagraphOpen, contentOffset, contentOffset);
        // Keep one chunk across contiguous lines; split only where source has a gap.
        let chunkOffset = contentOffset;
        let withBoundaryBreak = false;
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
          const newline = lines.end(index - 1);
          if (!withBoundaryBreak && source.charCodeAt(newline) === Character.LineFeed) {
            const previous = source.charCodeAt(newline - 1);
            if (
              previous === Character.Space ||
              previous === Character.CharacterTabulation ||
              source.charCodeAt(chunkStart) === Character.Space
            ) {
              withBoundaryBreak = true;
              tokens.setValue(openToken, boundaryBreak);
            }
          }
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
          const tokens = context.structure.tokens;
          const close = tokenStart + tokens.nodeLength(tokenStart) - 1;
          const start = context.locator.locationAt(tokens.start(tokenStart));
          const inline = buildInlineFragment(tokenStart, false, context);
          const result: Paragraph = {
            type: "paragraph",
            children: inline.children,
            position: {
              start,
              end: context.locator.locationAt(tokens.end(close)),
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
