import type { AlignType, TableCell, TableRow } from "mdast";
import {
  type BlockLines,
  lineIndentOffset,
  trimLineWhitespaceEnd,
  trimLineWhitespaceStart,
} from "../../block/lines.ts";
import { BlockKind } from "../../constants/block.ts";
import { Character } from "../../constants/character.ts";
import { buildInlineFragment } from "../../fragment/inline.ts";
import type { BlockTokenStream } from "../../block/tokens.ts";
import type { BlockBuildContext } from "../../fragment/block.ts";
import type { SyntaxFeature } from "../types.ts";

const enum DelimiterSlot {
  Start,
  Alignment,
  Stride,
}

function isEscapedPipe(source: string, contentOffset: number, pipe: number): boolean {
  let escapeStart = pipe;
  while (escapeStart > contentOffset && source.charCodeAt(escapeStart - 1) === Character.ReverseSolidus) {
    escapeStart--;
  }
  return ((pipe - escapeStart) & 1) !== 0;
}

function countHeaderCells(source: string, lines: BlockLines, index: number, contentOffset: number): number {
  const lineEnd = lines.end(index);
  const row = source.slice(contentOffset, lineEnd);
  let count = 0;
  let lastPipe = -1;
  for (let pipe = row.indexOf("|"); pipe >= 0; pipe = row.indexOf("|", pipe + 1)) {
    const sourcePipe = contentOffset + pipe;
    if (isEscapedPipe(source, contentOffset, sourcePipe)) {
      continue;
    }
    lastPipe = sourcePipe;
    if (pipe > 0) {
      count++;
    }
  }
  if (lastPipe < 0) {
    return 0;
  }

  const visibleEnd = trimLineWhitespaceEnd(source, contentOffset, lineEnd);
  return lastPipe !== visibleEnd - 1 ? count + 1 : count;
}

function delimiterAt(
  source: string,
  lines: BlockLines,
  index: number,
  contentOffset: number,
): number[] | undefined {
  const first = source.charCodeAt(contentOffset);
  if (
    first !== Character.HyphenMinus &&
    first !== Character.Colon &&
    first !== Character.VerticalLine
  ) {
    return;
  }
  const lineEnd = lines.end(index);
  const delimiter: number[] = [];
  let spanStart = contentOffset;
  let offset = first === Character.VerticalLine ? contentOffset + 1 : contentOffset;
  while (offset < lineEnd) {
    offset = trimLineWhitespaceStart(source, offset, lineEnd);
    if (offset === lineEnd) {
      break;
    }
    const left = source.charCodeAt(offset) === Character.Colon;
    if (left) {
      offset++;
    }
    const hyphenStart = offset;
    while (offset < lineEnd && source.charCodeAt(offset) === Character.HyphenMinus) {
      offset++;
    }
    if (offset === hyphenStart) {
      return;
    }
    const right = offset < lineEnd && source.charCodeAt(offset) === Character.Colon;
    if (right) {
      offset++;
    }
    offset = trimLineWhitespaceStart(source, offset, lineEnd);
    let nextSpanStart = lineEnd;
    if (offset < lineEnd) {
      if (source.charCodeAt(offset) !== Character.VerticalLine) {
        return;
      }
      nextSpanStart = offset;
      offset++;
    }
    delimiter.push(
      spanStart,
      left
        ? right ? BlockKind.TableAlignCenter : BlockKind.TableAlignLeft
        : right ? BlockKind.TableAlignRight : BlockKind.TableAlignNone,
    );
    spanStart = nextSpanStart;
  }
  return delimiter.length > 0 ? delimiter : void 0;
}

function emitTableCell(
  source: string,
  tokens: BlockTokenStream,
  spanStart: number,
  contentStart: number,
  contentEnd: number,
): void {
  contentStart = trimLineWhitespaceStart(source, contentStart, contentEnd);
  contentEnd = trimLineWhitespaceEnd(source, contentStart, contentEnd);
  // The possibly empty inline chunk closes the cell frame; the next cell or row close marks its end.
  tokens.pushInlineFrame(BlockKind.TableCellOpen, spanStart, spanStart, contentStart, contentEnd);
}

// Header validation proved an unescaped `|` exists; advancing `nextPipe` monotonically across
// rows keeps worst-case pipe discovery O(N) over the document without per-row slicing.
function emitTableRow(
  source: string,
  tokens: BlockTokenStream,
  contentOffset: number,
  lineEnd: number,
  visibleEnd: number,
  nextPipe: number,
): number {
  tokens.push(BlockKind.TableRowOpen, contentOffset, contentOffset);
  let contentStart = contentOffset;
  let spanStart = contentOffset;
  let lastPipe = -1;
  if (nextPipe !== -1 && nextPipe < contentOffset) {
    nextPipe = source.indexOf("|", contentOffset);
  }
  while (nextPipe >= 0 && nextPipe < lineEnd) {
    const pipe = nextPipe;
    nextPipe = source.indexOf("|", pipe + 1);
    if (isEscapedPipe(source, contentOffset, pipe)) {
      continue;
    }
    lastPipe = pipe;
    if (pipe === contentOffset) {
      contentStart++;
      continue;
    }
    emitTableCell(source, tokens, spanStart, contentStart, pipe);
    spanStart = pipe;
    contentStart = pipe + 1;
  }
  if (lastPipe !== visibleEnd - 1) {
    emitTableCell(source, tokens, spanStart, contentStart, lineEnd);
  }
  tokens.push(BlockKind.TableRowClose, lineEnd, lineEnd);
  return nextPipe;
}

function buildTableRow(tokenStart: number, context: BlockBuildContext): TableRow {
  const tokens = context.structure.tokens;
  const close = tokenStart + tokens.nodeLength(tokenStart) - 1;
  const start = context.locator.locationAt(tokens.start(tokenStart));
  const children: TableCell[] = [];
  for (let cell = tokenStart + 1; cell < close;) {
    const next = cell + tokens.nodeLength(cell);
    const start = context.locator.locationAt(tokens.start(cell));
    children.push({
      type: "tableCell",
      children: buildInlineFragment(cell, true, context).children,
      position: {
        start,
        end: context.locator.locationAt(tokens.start(next)),
      },
    });
    cell = next;
  }
  return {
    type: "tableRow",
    children,
    position: {
      start,
      end: context.locator.locationAt(tokens.start(close)),
    },
  };
}

function tableAlignment(
  tokenStart: number,
  context: BlockBuildContext,
): AlignType[] {
  const tokens = context.structure.tokens;
  const result: AlignType[] = [];
  for (
    let token = tokenStart;
    tokens.kind(token) !== BlockKind.TableRowOpen &&
    tokens.kind(token) !== BlockKind.TableClose;
    token++
  ) {
    const kind = tokens.kind(token);
    result.push(
      kind === BlockKind.TableAlignLeft
        ? "left"
        : kind === BlockKind.TableAlignRight
          ? "right"
          : kind === BlockKind.TableAlignCenter ? "center" : null,
    );
  }
  return result;
}

export const feature: SyntaxFeature = {
  block: {
    fallbacks: [
      (source, lines, tokens, start, contentOffset, context) => {
        const delimiterLine = start + 1;
        if (delimiterLine >= lines.length) {
          return;
        }
        const delimiterOffset = lineIndentOffset(source, lines, delimiterLine);
        if (
          delimiterOffset < 0 ||
          context.startsInterruptingBlock(source, lines, delimiterLine, delimiterOffset)
        ) {
          return;
        }
        const delimiter = delimiterAt(source, lines, delimiterLine, delimiterOffset);
        if (
          !delimiter ||
          countHeaderCells(source, lines, start, contentOffset) !== delimiter.length / DelimiterSlot.Stride
        ) {
          return;
        }

        tokens.push(BlockKind.TableOpen, contentOffset, contentOffset);
        const headerEnd = lines.end(start);
        let nextPipe = emitTableRow(
          source,
          tokens,
          contentOffset,
          headerEnd,
          trimLineWhitespaceEnd(source, contentOffset, headerEnd),
          source.indexOf("|", contentOffset),
        );
        const delimiterEnd = lines.end(delimiterLine);
        for (let cell = 0; cell < delimiter.length; cell += DelimiterSlot.Stride) {
          tokens.push(
            delimiter[cell + DelimiterSlot.Alignment],
            delimiter[cell + DelimiterSlot.Start],
            delimiter[cell + DelimiterSlot.Stride + DelimiterSlot.Start] ?? delimiterEnd,
          );
        }

        let end = start + 2;
        while (end < lines.length) {
          const contentOffset = lineIndentOffset(source, lines, end);
          if (
            contentOffset < 0 ||
            context.startsInterruptingBlock(source, lines, end, contentOffset)
          ) {
            break;
          }
          const lineEnd = lines.end(end);
          const visibleEnd = trimLineWhitespaceEnd(source, contentOffset, lineEnd);
          if (visibleEnd === contentOffset + 1 && source.charCodeAt(contentOffset) === Character.VerticalLine) {
            break;
          }
          nextPipe = emitTableRow(source, tokens, contentOffset, lineEnd, visibleEnd, nextPipe);
          end++;
        }
        const tableEnd = lines.end(end - 1);
        tokens.push(BlockKind.TableClose, tableEnd, tableEnd);
        return end;
      },
    ],
    builds: [
      {
        token: BlockKind.TableOpen,
        build(tokenStart, context) {
          const tokens = context.structure.tokens;
          const close = tokenStart + tokens.nodeLength(tokenStart) - 1;
          const start = context.locator.locationAt(tokens.start(tokenStart));
          // Tables are emitted as a header row, delimiter leaves, then body rows.
          const header = tokenStart + 1;
          const delimiter = header + tokens.nodeLength(header);
          const align = tableAlignment(delimiter, context);
          const rows = [buildTableRow(header, context)];
          for (let row = delimiter + align.length; row < close; row += tokens.nodeLength(row)) {
            rows.push(buildTableRow(row, context));
          }
          return {
            type: "table",
            align,
            children: rows,
            position: {
              start,
              end: context.locator.locationAt(tokens.start(close)),
            },
          };
        },
      },
    ],
  },
};
