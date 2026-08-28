import { BlockLines, isBlank, lineIndentOffset, physicalColumnAt } from "../../block/lines.ts";
import { BlockKind, BlockRule } from "../../constants/block.ts";
import { Character } from "../../constants/character.ts";
import { blockEnd, buildBlockChildren } from "../../fragment/block.ts";
import type { SyntaxFeature } from "../types.ts";

interface BlockQuoteMarker {
  offset: number;
  prefixColumns: number;
}

function blockQuoteOffset(
  source: string,
  lines: BlockLines,
  index: number,
  markerOffset: number,
): BlockQuoteMarker | undefined {
  if (markerOffset < 0 || source[markerOffset] !== ">") {
    return;
  }
  let offset = markerOffset + 1;
  let prefixColumns = lines.prefixColumns(index);
  if (source[offset] === " ") {
    offset++;
  }
  else if (source[offset] === "\t") {
    prefixColumns += 4 - (physicalColumnAt(source, offset) % 4) - 1;
    offset++;
  }
  return { offset, prefixColumns };
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
          const start = context.locator.locationAt(tokens.start(tokenStart));
          const children = buildBlockChildren(tokenStart, context);
          return {
            type: "blockquote",
            children,
            position: {
              start,
              end: context.locator.locationAt(blockEnd(tokenStart, context)),
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
        unwrapLazyContinuation(source, lines, index, contentOffset, target) {
          const marker = blockQuoteOffset(source, lines, index, contentOffset);
          if (!marker) {
            return false;
          }
          target.resetFrom(lines, index, marker.offset, marker.prefixColumns);
          return true;
        },
        interrupt() {
          return true;
        },
        start(source, lines, start, contentOffset, out, context) {
          const quoteLines = new BlockLines();
          let index = start;
          let lazyParagraph = false;
          for (; index < lines.length; index++) {
            const markerOffset = index === start
              ? contentOffset
              : lineIndentOffset(source, lines, index);
            const marker = blockQuoteOffset(source, lines, index, markerOffset);
            if (marker) {
              quoteLines.pushFrom(lines, index, marker.offset, marker.prefixColumns);
              lazyParagraph = context.endsWithParagraphLeaf(source, quoteLines, quoteLines.length - 1);
              continue;
            }
            if (
              !lazyParagraph ||
              isBlank(source, lines, index) ||
              !lines.lazy(index) && context.startsInterruptingBlock(source, lines, index, markerOffset)
            ) {
              break;
            }
            quoteLines.pushLazy(lines, index);
          }
          out.push(BlockKind.BlockQuoteOpen, contentOffset, contentOffset + 1);
          context.scanLines(source, quoteLines, out);
          const end = quoteLines.next(quoteLines.length - 1);
          out.push(BlockKind.BlockQuoteClose, end, end);
          return index;
        },
      },
    ],
  },
};
