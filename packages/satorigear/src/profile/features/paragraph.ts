import { indentOffset, isBlank, lineIndentOffset } from "../../block/lines.ts";
import { BlockKind, BlockRule } from "../../constants/block.ts";
import { blockEnd } from "../../fragment/block.ts";
import { firstChildStart } from "../../fragment/node.ts";
import { setextMarkerAt } from "./heading.ts";
import type { SyntaxFeature } from "../types.ts";

export const feature: SyntaxFeature = {
  block: {
    fallbacks: [
      (source, lines, start, contentOffset, out, context) => {
        // Earlier fallbacks rejected this nonblank line, so it begins the paragraph.
        const openToken = out.length;
        const offset = lines.start(start);
        out.push(BlockKind.ParagraphOpen, offset, offset);
        // Hold one line so only the final inline chunk excludes its line ending.
        let chunkOffset = contentOffset;
        let index = start + 1;
        while (index < lines.length) {
          const lineOffset = lines.lazy(index)
            ? -1
            : lineIndentOffset(source, lines, index);
          // Only lazy or deeply indented lines need a separate blank-line scan.
          if (lineOffset < 0) {
            if (isBlank(source, lines, index)) {
              break;
            }
          }
          else {
            if (lineOffset === lines.end(index)) {
              break;
            }
            const setext = setextMarkerAt(source, lines, index, lineOffset);
            if (setext) {
              out.setKind(
                openToken,
                setext === "=" ? BlockKind.SetextHeading1Open : BlockKind.SetextHeading2Open,
              );
              out.push(BlockKind.InlineChunk, chunkOffset, lines.end(index - 1));
              const lineEnd = lines.end(index);
              out.push(BlockKind.HeadingClose, lineEnd, lineEnd);
              return index + 1;
            }
            if (context.startsInterruptingBlock(source, lines, index, lineOffset)) {
              break;
            }
          }
          out.push(BlockKind.InlineChunk, chunkOffset, lines.next(index - 1));
          chunkOffset = lineOffset < 0
            ? indentOffset(source, lines, index)
            : lineOffset;
          index++;
        }
        const close = lines.end(index - 1);
        out.push(BlockKind.InlineChunk, chunkOffset, close);
        out.push(BlockKind.ParagraphClose, close, close);
        return index;
      },
    ],
    rules: [
      {
        rule: BlockRule.Paragraph,
        syntax: {
          kind: "block",
          open: BlockKind.ParagraphOpen,
          close: BlockKind.ParagraphClose,
        },
        inlineContent: true,
        build(tokenStart, context, inline) {
          const children = inline!.children;
          return {
            type: "paragraph",
            children,
            position: {
              start: firstChildStart(children),
              end: blockEnd(tokenStart, context),
            },
          };
        },
      },
    ],
  },
};
