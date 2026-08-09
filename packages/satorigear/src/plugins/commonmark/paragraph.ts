import type { Paragraph } from "mdast";
import {
  indentOf,
  isBlank,
  named,
  structural,
} from "../../block/scanner.ts";
import { blockEnd, firstChildStart, inlineChildren, withSpan } from "../../mdast.ts";
import { setextMarkerAt } from "./heading.ts";
import type { BlockToken } from "../../block/tokens.ts";
import type { BlockLine, InternalSyntaxPlugin } from "../plugin.ts";

function emitInlineChunks(source: string, lines: readonly BlockLine[], out: BlockToken[]): void {
  lines.forEach((line, index) => {
    const offset = indentOf(source, line, 3).offset;
    const end = index < lines.length - 1 ? line.next : line.end;
    if (end > offset) {
      out.push(named("InlineChunk", source.slice(offset, end), offset));
    }
  });
}

function emitParagraph(source: string, lines: readonly BlockLine[], out: BlockToken[]): void {
  if (lines.length === 0) {
    return;
  }
  out.push(structural("ParagraphOpen", lines[0].start));
  emitInlineChunks(source, lines, out);
  out.push(structural("ParagraphClose", lines[lines.length - 1].end));
}

export const paragraphPlugin: InternalSyntaxPlugin = {
  blockFallbacks: [
    (source, lines, start, out, _contentOffset, context) => {
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
          out.push(structural(setext === "=" ? "SetextHeading1Open" : "SetextHeading2Open", paragraph[0].start));
          emitInlineChunks(source, paragraph, out);
          out.push(structural("HeadingClose", line.end));
          return index + 1;
        }
        if (paragraph.length > 0 && context.interruptsParagraph(source, line)) {
          break;
        }
        paragraph.push(line);
        index++;
      }
      emitParagraph(source, paragraph, out);
      return index;
    },
  ],
  blockRules: [
    {
      rule: "Paragraph",
      inlineContent: true,
      project(nodeId, offset, _tokenBase, context) {
        const result = { type: "paragraph", children: inlineChildren(nodeId, context) } satisfies Paragraph;
        return withSpan(result, firstChildStart(result), blockEnd(nodeId, offset, context));
      },
    },
  ],
};
