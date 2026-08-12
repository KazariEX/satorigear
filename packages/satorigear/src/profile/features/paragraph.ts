import { type BlockLine, indentOf, isBlank } from "../../block/lines.ts";
import { blockEnd } from "../../fragment/block.ts";
import { buildInlineChildren } from "../../fragment/inline.ts";
import { firstChildStart } from "../../fragment/node.ts";
import { setextMarkerAt } from "./heading.ts";
import type { BlockToken } from "../../block/tokens.ts";
import type { SyntaxFeature } from "../types.ts";

function emitInlineChunks(source: string, lines: readonly BlockLine[], out: BlockToken[]): void {
  lines.forEach((line, index) => {
    const offset = indentOf(source, line, 3).offset;
    const end = index < lines.length - 1 ? line.next : line.end;
    if (end > offset) {
      out.push({
        type: "InlineChunk",
        text: source.slice(offset, end),
        offset,
      });
    }
  });
}

function emitParagraph(source: string, lines: readonly BlockLine[], out: BlockToken[]): void {
  if (lines.length === 0) {
    return;
  }
  out.push({
    type: "ParagraphOpen",
    text: "",
    offset: lines[0].start,
  });
  emitInlineChunks(source, lines, out);
  out.push({
    type: "ParagraphClose",
    text: "",
    offset: lines[lines.length - 1].end,
  });
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
            out.push({
              type: setext === "=" ? "SetextHeading1Open" : "SetextHeading2Open",
              text: "",
              offset: paragraph[0].start,
            });
            emitInlineChunks(source, paragraph, out);
            out.push({
              type: "HeadingClose",
              text: "",
              offset: line.end,
            });
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
          open: "ParagraphOpen",
          close: "ParagraphClose",
        },
        inlineContent: true,
        build(nodeId, offset, tokenBase, context) {
          const children = buildInlineChildren(nodeId, context);
          return {
            type: "paragraph",
            children,
            position: {
              start: firstChildStart(children),
              end: blockEnd(nodeId, offset, context),
            },
          };
        },
      },
    ],
  },
};
