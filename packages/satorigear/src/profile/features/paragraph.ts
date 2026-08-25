import { type BlockLine, indentOf, isBlank } from "../../block/lines.ts";
import { BlockKind, BlockRule } from "../../constants/block.ts";
import { blockEnd } from "../../fragment/block.ts";
import { firstChildStart } from "../../fragment/node.ts";
import { setextMarkerAt } from "./heading.ts";
import type { BlockTokenStream } from "../../block/tokens.ts";
import type { SyntaxFeature } from "../types.ts";

function emitInlineChunks(
  source: string,
  lines: readonly BlockLine[],
  start: number,
  end: number,
  out: BlockTokenStream,
): void {
  while (start < end) {
    const line = lines[start++];
    const offset = indentOf(source, line, 3).offset;
    const chunkEnd = start < end ? line.next : line.end;
    if (chunkEnd > offset) {
      out.push(BlockKind.InlineChunk, offset, chunkEnd);
    }
  }
}

export const feature: SyntaxFeature = {
  block: {
    fallbacks: [
      (source, lines, start, out, context) => {
        let index = start;
        while (index < lines.length) {
          const line = lines[index];
          if (isBlank(source, line)) {
            break;
          }
          if (line.lazy) {
            index++;
            continue;
          }
          const setext = setextMarkerAt(source, line);
          if (index > start && setext) {
            out.push(
              setext === "=" ? BlockKind.SetextHeading1Open : BlockKind.SetextHeading2Open,
              lines[start].start,
              lines[start].start,
            );
            emitInlineChunks(source, lines, start, index, out);
            out.push(BlockKind.HeadingClose, line.end, line.end);
            return index + 1;
          }
          if (index > start && context.startsInterruptingBlock(source, line)) {
            break;
          }
          index++;
        }
        if (index > start) {
          const offset = lines[start].start;
          out.push(BlockKind.ParagraphOpen, offset, offset);
          emitInlineChunks(source, lines, start, index, out);
          const close = lines[index - 1].end;
          out.push(BlockKind.ParagraphClose, close, close);
        }
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
