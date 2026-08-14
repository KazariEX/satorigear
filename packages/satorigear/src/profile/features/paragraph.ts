import { BlockKind } from "../../block/kinds.ts";
import { type BlockLine, indentOf, isBlank } from "../../block/lines.ts";
import { blockEnd } from "../../fragment/block.ts";
import { buildInlineChildren } from "../../fragment/inline.ts";
import { firstChildStart } from "../../fragment/node.ts";
import { setextMarkerAt } from "./heading.ts";
import type { BlockTokenStream } from "../../block/tokens.ts";
import type { SyntaxFeature } from "../types.ts";

function emitInlineChunks(source: string, lines: readonly BlockLine[], out: BlockTokenStream): void {
  lines.forEach((line, index) => {
    const offset = indentOf(source, line, 3).offset;
    const end = index < lines.length - 1 ? line.next : line.end;
    if (end > offset) {
      out.push(BlockKind.InlineChunk, offset, end);
    }
  });
}

function emitParagraph(source: string, lines: readonly BlockLine[], out: BlockTokenStream): void {
  if (lines.length === 0) {
    return;
  }
  out.push(BlockKind.ParagraphOpen, lines[0].start, lines[0].start);
  emitInlineChunks(source, lines, out);
  const end = lines[lines.length - 1].end;
  out.push(BlockKind.ParagraphClose, end, end);
}

export const feature: SyntaxFeature = {
  block: {
    fallbacks: [
      (source, lines, start, out, context) => {
        const paragraph: BlockLine[] = [];
        let index = start;
        while (index < lines.length) {
          const line = lines[index];
          if (isBlank(source, line)) {
            break;
          }
          if (line.lazy) {
            paragraph.push(line);
            index++;
            continue;
          }
          const setext = setextMarkerAt(source, line);
          if (paragraph.length > 0 && setext) {
            out.push(
              setext === "=" ? BlockKind.SetextHeading1Open : BlockKind.SetextHeading2Open,
              paragraph[0].start,
              paragraph[0].start,
            );
            emitInlineChunks(source, paragraph, out);
            out.push(BlockKind.HeadingClose, line.end, line.end);
            return index + 1;
          }
          if (paragraph.length > 0 && context.startsInterruptingBlock(source, line)) {
            break;
          }
          paragraph.push(line);
          index++;
        }
        emitParagraph(source, paragraph, out);
        return index;
      },
    ],
    rules: [
      {
        rule: "Paragraph",
        syntax: {
          kind: "block",
          open: BlockKind.ParagraphOpen,
          close: BlockKind.ParagraphClose,
        },
        inlineContent: true,
        build(tokenStart, context) {
          const children = buildInlineChildren(tokenStart, context);
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
