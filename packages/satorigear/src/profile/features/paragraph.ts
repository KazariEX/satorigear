import type { Paragraph } from "mdast";
import { trimLineWhitespaceStart } from "../../block/lines.ts";
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
        const firstToken = tokens.length;
        let opened = false;
        let kind = BlockKind.ParagraphOpen;
        let end = contentOffset;
        // Keep one chunk across contiguous lines; split only where source has a gap.
        let chunkOffset = contentOffset;
        let chunkEnd = lines.end(start);
        let withBoundaryBreak = false;
        let index = start + 1;
        while (index < lines.length) {
          const lineStart = lines.start(index);
          const lineEnd = lines.end(index);
          let spaceEnd = lineStart;
          let first = source.charCodeAt(spaceEnd);
          while (spaceEnd < lineEnd && first === Character.Space) {
            first = source.charCodeAt(++spaceEnd);
          }
          const contentStart = spaceEnd < lineEnd && first === Character.CharacterTabulation
            ? trimLineWhitespaceStart(source, spaceEnd + 1, lineEnd)
            : spaceEnd;
          if (contentStart === lineEnd) {
            break;
          }
          const chunkStart = Math.min(spaceEnd, lineStart + Math.max(0, 3 - lines.prefixColumns(index)));
          const canInterrupt = !lines.lazy(index) && chunkStart === contentStart;
          if (canInterrupt) {
            const setext = setextMarkerAt(source, lines, index, contentStart);
            if (setext) {
              kind = setext === Character.EqualsSign ? BlockKind.SetextHeading1Open : BlockKind.SetextHeading2Open;
              end = lineEnd;
              index++;
              break;
            }
            if (context.startsInterruptingBlock(source, lines, index, contentStart)) {
              break;
            }
          }
          const previousEnd = lines.next(index - 1);
          if (!withBoundaryBreak) {
            const previous = source.charCodeAt(chunkEnd - 1);
            const padded = (
              previous === Character.Space ||
              previous === Character.CharacterTabulation ||
              chunkStart < contentStart && source.charCodeAt(chunkStart) === Character.Space
            );
            if (padded && source.charCodeAt(chunkEnd) === Character.LineFeed) {
              withBoundaryBreak = true;
            }
          }
          if (chunkStart !== previousEnd) {
            if (!opened) {
              opened = true;
              tokens.push(BlockKind.ParagraphOpen, contentOffset, contentOffset);
            }
            tokens.push(BlockKind.InlineChunk, chunkOffset, previousEnd);
            chunkOffset = chunkStart;
          }
          chunkEnd = lineEnd;
          index++;
        }
        if (opened) {
          if (kind !== BlockKind.ParagraphOpen) {
            tokens.setKind(firstToken, kind);
            tokens.setEnd(firstToken, end);
          }
          tokens.closeRange(chunkOffset, chunkEnd);
        }
        else {
          tokens.pushInlineFrame(kind, contentOffset, end, chunkOffset, chunkEnd);
        }
        if (withBoundaryBreak) {
          tokens.setValue(firstToken, boundaryBreak);
        }
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
