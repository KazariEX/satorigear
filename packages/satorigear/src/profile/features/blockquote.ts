import type { Blockquote } from "mdast";
import {
  type BlockLines,
  isBlankLine,
  lineIndentOffset,
  physicalColumnAt,
} from "../../block/lines.ts";
import { BlockKind } from "../../constants/block.ts";
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
  if (markerOffset < 0 || source.charCodeAt(markerOffset) !== Character.GreaterThanSign) {
    return;
  }
  let offset = markerOffset + 1;
  let prefixColumns = lines.prefixColumns(index);
  if (source.charCodeAt(offset) === Character.Space) {
    offset++;
  }
  else if (source.charCodeAt(offset) === Character.CharacterTabulation) {
    prefixColumns += 4 - (physicalColumnAt(source, offset) % 4) - 1;
    offset++;
  }
  return { offset, prefixColumns };
}

export const feature: SyntaxFeature = {
  block: {
    builds: [
      {
        token: BlockKind.BlockQuoteOpen,
        build(tokenStart, context) {
          const tokens = context.structure.tokens;
          const start = context.locator.locationAt(tokens.start(tokenStart));
          const children = buildBlockChildren<Blockquote["children"][number]>(tokenStart, context);
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
        start(source, lines, tokens, start, contentOffset, context) {
          // Dispatch on `>` proves the opening marker before this container starts.
          const firstMarker = blockQuoteOffset(source, lines, start, contentOffset)!;
          const quoteLines = context.createLineView(
            lines,
            start,
            firstMarker.offset,
            firstMarker.prefixColumns,
          );
          let index = start + 1;
          let lazyParagraph: boolean | undefined;
          for (; index < lines.length; index++) {
            const markerOffset = lineIndentOffset(source, lines, index);
            const marker = blockQuoteOffset(source, lines, index, markerOffset);
            if (marker) {
              quoteLines.pushFrom(lines, index, marker.offset, marker.prefixColumns);
              lazyParagraph = void 0;
              continue;
            }
            lazyParagraph ??= context.endsWithParagraphLeaf(source, quoteLines, quoteLines.length - 1);
            // A recognized content offset already proves that the line is nonblank.
            if (
              !lazyParagraph ||
              markerOffset < 0 && isBlankLine(source, lines, index) ||
              !lines.lazy(index) && context.startsInterruptingBlock(source, lines, index, markerOffset)
            ) {
              break;
            }
            quoteLines.pushLazy(lines, index);
          }
          tokens.push(BlockKind.BlockQuoteOpen, contentOffset, contentOffset + 1);
          context.scanLines(source, quoteLines, tokens);
          const end = quoteLines.next(quoteLines.length - 1);
          tokens.push(BlockKind.BlockQuoteClose, end, end);
          return index;
        },
      },
    ],
  },
};
