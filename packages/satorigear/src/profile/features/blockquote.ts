import type { Blockquote } from "mdast";
import {
  type BlockLine,
  isBlank,
  lineIndent,
  physicalColumnAt,
  structural,
} from "../../block/primitives.ts";
import {
  blockChildren,
  blockEnd,
  blockToken,
  firstNonspace,
  lineEnd,
  tokenStart,
  withSpan,
} from "../../mdast.ts";
import type { SyntaxFeature } from "../types.ts";

interface BlockQuoteMarker {
  offset: number;
  prefixColumns: number;
}

function blockQuoteOffset(source: string, line: BlockLine): BlockQuoteMarker | null {
  const indent = lineIndent(source, line);
  if (!indent || source[indent.offset] !== ">") {
    return null;
  }
  let offset = indent.offset + 1;
  let prefixColumns = line.prefixColumns ?? 0;
  if (source[offset] === " ") {
    offset++;
  }
  else if (source[offset] === "\t") {
    prefixColumns += 4 - (physicalColumnAt(source, offset) % 4) - 1;
    offset++;
  }
  return { offset, prefixColumns };
}

function unwrapBlockQuote(source: string, line: BlockLine): BlockLine | undefined {
  const marker = blockQuoteOffset(source, line);
  return marker ? { ...line, start: marker.offset, prefixColumns: marker.prefixColumns } : void 0;
}

export const feature: SyntaxFeature = {
  blockRules: [
    {
      rule: "BlockQuote",
      project(nodeId, offset, tokenBase, context) {
        const result: Blockquote = {
          type: "blockquote",
          children: blockChildren(nodeId, offset, tokenBase, context),
        };
        const marker = blockToken(nodeId, tokenBase, "BlockQuoteOpen", context);
        const start = firstNonspace(context.source, tokenStart(marker), lineEnd(context.source, offset));
        return withSpan(result, start, blockEnd(nodeId, offset, context));
      },
    },
  ],
  blockStarts: [
    {
      codes: [62],
      interrupt(source, line) {
        return blockQuoteOffset(source, line) !== null;
      },
      start(source, lines, start, out, contentOffset, context) {
        const line = lines[start];
        if (blockQuoteOffset(source, line) === null) {
          return void 0;
        }
        const quoteLines: BlockLine[] = [];
        let index = start;
        let lazyParagraph = false;
        while (index < lines.length) {
          const contentLine = unwrapBlockQuote(source, lines[index]);
          if (contentLine) {
            quoteLines.push(contentLine);
            lazyParagraph = context.endsWithParagraphLeaf(source, contentLine);
            index++;
            continue;
          }
          if (
            !lazyParagraph ||
            isBlank(source, lines[index]) ||
            !lines[index].lazy && context.startsInterruptingBlock(source, lines[index])
          ) {
            break;
          }
          quoteLines.push({ ...lines[index], lazy: true });
          index++;
        }
        out.push(structural("BlockQuoteOpen", line.start, ">"));
        context.resolveLines(source, quoteLines, out);
        out.push(structural("BlockQuoteClose", quoteLines.at(-1)?.next ?? line.start));
        return index;
      },
    },
  ],
  blockUnwrappers: [unwrapBlockQuote],
};
