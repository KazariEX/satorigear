import { type BlockLines, indentOffset, isBlank, lineIndentOffset } from "../../block/lines.ts";
import { BlockKind, BlockRule } from "../../constants/block.ts";
import { blockEnd } from "../../fragment/block.ts";
import { firstChildStart } from "../../fragment/node.ts";
import { setextMarkerAt } from "./heading.ts";
import type { BlockTokenStream } from "../../block/tokens.ts";
import type { SyntaxFeature } from "../types.ts";

function emitInlineChunks(
  source: string,
  lines: BlockLines,
  start: number,
  end: number,
  out: BlockTokenStream,
): void {
  while (start < end) {
    const line = start++;
    const offset = indentOffset(source, lines, line);
    const chunkEnd = start < end ? lines.next(line) : lines.end(line);
    if (chunkEnd > offset) {
      out.push(BlockKind.InlineChunk, offset, chunkEnd);
    }
  }
}

export const feature: SyntaxFeature = {
  block: {
    fallbacks: [
      (source, lines, start, contentOffset, out, context) => {
        // Earlier fallbacks rejected this nonblank line, so it begins the paragraph.
        let index = start + 1;
        while (index < lines.length) {
          if (isBlank(source, lines, index)) {
            break;
          }
          if (lines.lazy(index)) {
            index++;
            continue;
          }
          const contentOffset = lineIndentOffset(source, lines, index);
          const setext = setextMarkerAt(source, lines, index, contentOffset);
          if (setext) {
            const headingStart = lines.start(start);
            out.push(
              setext === "=" ? BlockKind.SetextHeading1Open : BlockKind.SetextHeading2Open,
              headingStart,
              headingStart,
            );
            emitInlineChunks(source, lines, start, index, out);
            const lineEnd = lines.end(index);
            out.push(BlockKind.HeadingClose, lineEnd, lineEnd);
            return index + 1;
          }
          if (context.startsInterruptingBlock(source, lines, index, contentOffset)) {
            break;
          }
          index++;
        }
        const offset = lines.start(start);
        out.push(BlockKind.ParagraphOpen, offset, offset);
        emitInlineChunks(source, lines, start, index, out);
        const close = lines.end(index - 1);
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
