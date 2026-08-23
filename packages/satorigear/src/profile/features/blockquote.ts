import {
  type BlockLine,
  isBlank,
  lineIndent,
  physicalColumnAt,
} from "../../block/lines.ts";
import { BlockKind, BlockRule } from "../../constants/block.ts";
import { Character } from "../../constants/character.ts";
import { blockEnd, buildBlockChildren } from "../../fragment/block.ts";
import type { SyntaxFeature } from "../types.ts";

interface BlockQuoteMarker {
  offset: number;
  prefixColumns: number;
}

function blockQuoteOffset(source: string, line: BlockLine): BlockQuoteMarker | undefined {
  const indent = lineIndent(source, line);
  if (!indent || source[indent.offset] !== ">") {
    return;
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
  block: {
    rules: [
      {
        rule: BlockRule.BlockQuote,
        syntax: {
          kind: "block",
          open: BlockKind.BlockQuoteOpen,
          close: BlockKind.BlockQuoteClose,
        },
        build(tokenStart, context) {
          const tokens = context.structure.tokens;
          return {
            type: "blockquote",
            children: buildBlockChildren(tokenStart, context),
            position: {
              start: tokens.start(tokenStart),
              end: blockEnd(tokenStart, context),
            },
          };
        },
      },
    ],
    starts: [
      {
        codes: [
          Character.GreaterThanSign,
        ],
        unwrapLazyContinuation: unwrapBlockQuote,
        interrupt(source, line) {
          return blockQuoteOffset(source, line) !== void 0;
        },
        start(source, lines, start, out, contentOffset, context) {
          const line = lines[start];
          if (blockQuoteOffset(source, line) === void 0) {
            return;
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
          out.push(BlockKind.BlockQuoteOpen, contentOffset, contentOffset + 1);
          context.scanLines(source, quoteLines, out);
          const end = quoteLines.at(-1)?.next ?? line.start;
          out.push(BlockKind.BlockQuoteClose, end, end);
          return index;
        },
      },
    ],
  },
};
