import type { Paragraph } from "mdast";
import { type BlockLine, indentOf, isBlank } from "../../block/lines.ts";
import { type BlockToken, namedToken, structuralToken } from "../../block/tokens.ts";
import { blockEnd } from "../../fragment/block.ts";
import { inlineChildren } from "../../fragment/inline.ts";
import { firstChildStart, withSpan } from "../../fragment/node.ts";
import { setextMarkerAt } from "./heading.ts";
import type { SyntaxFeature } from "../types.ts";

function emitInlineChunks(source: string, lines: readonly BlockLine[], out: BlockToken[]): void {
  lines.forEach((line, index) => {
    const offset = indentOf(source, line, 3).offset;
    const end = index < lines.length - 1 ? line.next : line.end;
    if (end > offset) {
      out.push(namedToken("InlineChunk", source.slice(offset, end), offset));
    }
  });
}

function emitParagraph(source: string, lines: readonly BlockLine[], out: BlockToken[]): void {
  if (lines.length === 0) {
    return;
  }
  out.push(structuralToken("ParagraphOpen", lines[0].start));
  emitInlineChunks(source, lines, out);
  out.push(structuralToken("ParagraphClose", lines[lines.length - 1].end));
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
            out.push(structuralToken(setext === "=" ? "SetextHeading1Open" : "SetextHeading2Open", paragraph[0].start));
            emitInlineChunks(source, paragraph, out);
            out.push(structuralToken("HeadingClose", line.end));
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
          const result: Paragraph = { type: "paragraph", children: inlineChildren(nodeId, context) };
          return withSpan(result, firstChildStart(result), blockEnd(nodeId, offset, context));
        },
      },
    ],
  },
};
