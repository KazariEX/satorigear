import type { AlignType, TableCell, TableRow } from "mdast";
import {
  type BlockLines,
  lineIndentOffset,
  trimLineWhitespaceEnd,
  trimLineWhitespaceStart,
} from "../../block/lines.ts";
import { BlockKind } from "../../constants/block.ts";
import { Character } from "../../constants/character.ts";
import { buildBlockChildren } from "../../fragment/block.ts";
import { buildInlineFragment } from "../../fragment/inline.ts";
import type { BlockTokenStream } from "../../block/tokens.ts";
import type { BlockBuildContext, BlockNodeBuilder } from "../../fragment/block.ts";
import type { SyntaxFeature } from "../types.ts";

// Cell records start as [frame start, trimmed content start, trimmed content end].
// Delimiter validation reuses the content-start slot for its alignment kind.
const enum CellSlot {
  ContentStart = 1,
  Alignment = ContentStart,
  ContentEnd = 2,
  Stride = 3,
}

function appendTableCell(
  cells: number[],
  source: string,
  start: number,
  contentStart: number,
  contentEnd: number,
): void {
  contentStart = trimLineWhitespaceStart(source, contentStart, contentEnd);
  contentEnd = trimLineWhitespaceEnd(source, contentStart, contentEnd);
  cells.push(start, contentStart, contentEnd);
}

function tableCellsAt(
  source: string,
  lines: BlockLines,
  index: number,
  requirePipe: boolean,
  contentOffset: number,
): number[] | undefined {
  if (contentOffset < 0) {
    return;
  }

  const lineEnd = lines.end(index);
  const row = source.slice(contentOffset, lineEnd);
  const cells: number[] = [];
  let contentStart = contentOffset;
  let spanStart = contentOffset;
  let lastPipe: number | undefined;
  for (let pipe = row.indexOf("|"); pipe >= 0; pipe = row.indexOf("|", pipe + 1)) {
    let escapeStart = pipe;
    while (escapeStart > 0 && row.charCodeAt(escapeStart - 1) === Character.ReverseSolidus) {
      escapeStart--;
    }
    if ((pipe - escapeStart) % 2 !== 0) {
      continue;
    }
    lastPipe = contentOffset + pipe;
    if (pipe === 0) {
      contentStart++;
      continue;
    }
    appendTableCell(cells, source, spanStart, contentStart, lastPipe);
    spanStart = lastPipe;
    contentStart = lastPipe + 1;
  }
  if (requirePipe && lastPipe === void 0) {
    return;
  }

  const visibleEnd = trimLineWhitespaceEnd(source, contentOffset, lineEnd);
  if (lastPipe !== visibleEnd - 1) {
    appendTableCell(cells, source, spanStart, contentStart, lineEnd);
  }
  return cells.length > 0 ? cells : void 0;
}

function alignmentAt(source: string, cells: readonly number[], cell: number): BlockKind | undefined {
  let start = cells[cell + CellSlot.ContentStart];
  let end = cells[cell + CellSlot.ContentEnd];
  const left = source.charCodeAt(start) === Character.Colon;
  if (left) {
    start++;
  }
  const right = source.charCodeAt(end - 1) === Character.Colon;
  if (right) {
    end--;
  }
  if (start >= end) {
    return;
  }
  for (let offset = start; offset < end; offset++) {
    if (source.charCodeAt(offset) !== Character.HyphenMinus) {
      return;
    }
  }
  return left
    ? right ? BlockKind.TableAlignCenter : BlockKind.TableAlignLeft
    : right ? BlockKind.TableAlignRight : BlockKind.TableAlignNone;
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
  const cells = tableCellsAt(source, lines, index, false, contentOffset);
  if (!cells) {
    return;
  }
  for (let cell = 0; cell < cells.length; cell += CellSlot.Stride) {
    const alignment = alignmentAt(source, cells, cell);
    if (alignment === void 0) {
      return;
    }
    cells[cell + CellSlot.Alignment] = alignment;
  }
  return cells;
}

function emitTableRow(
  lines: BlockLines,
  tokens: BlockTokenStream,
  index: number,
  cells: readonly number[],
): void {
  tokens.push(BlockKind.TableRowOpen, cells[0], cells[0]);
  for (let cell = 0; cell < cells.length; cell += CellSlot.Stride) {
    // The possibly empty inline chunk closes the cell frame. The next cell or
    // row-close token marks its outer end, so no separate close token is needed.
    const start = cells[cell];
    tokens.push(BlockKind.TableCellOpen, start, start);
    tokens.closeRange(
      cells[cell + CellSlot.ContentStart],
      cells[cell + CellSlot.ContentEnd],
    );
  }
  const lineEnd = lines.end(index);
  tokens.push(BlockKind.TableRowClose, lineEnd, lineEnd);
}

const buildTableCell: BlockNodeBuilder<TableCell> = (tokenStart, context) => {
  const tokens = context.structure.tokens;
  const start = context.locator.locationAt(tokens.start(tokenStart));
  const children = buildInlineFragment(tokenStart, true, context).children;
  return {
    type: "tableCell",
    children,
    position: {
      start,
      end: context.locator.locationAt(
        tokens.start(tokenStart + tokens.nodeLength(tokenStart)),
      ),
    },
  };
};

const buildTableRow: BlockNodeBuilder<TableRow> = (tokenStart, context) => {
  const tokens = context.structure.tokens;
  const close = tokenStart + tokens.nodeLength(tokenStart) - 1;
  const start = context.locator.locationAt(tokens.start(tokenStart));
  const children = buildBlockChildren<TableCell>(tokenStart, context);
  return {
    type: "tableRow",
    children,
    position: {
      start,
      end: context.locator.locationAt(tokens.start(close)),
    },
  };
};

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
        if (!delimiter) {
          return;
        }
        const header = tableCellsAt(source, lines, start, true, contentOffset);
        if (header?.length !== delimiter.length) {
          return;
        }

        tokens.push(BlockKind.TableOpen, header[0], header[0]);
        emitTableRow(lines, tokens, start, header);
        const delimiterEnd = lines.end(delimiterLine);
        for (let cell = 0; cell < delimiter.length; cell += CellSlot.Stride) {
          tokens.push(
            delimiter[cell + CellSlot.Alignment],
            delimiter[cell],
            delimiter[cell + CellSlot.Stride] ?? delimiterEnd,
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
          const cells = tableCellsAt(source, lines, end, false, contentOffset);
          if (!cells) {
            break;
          }
          emitTableRow(lines, tokens, end, cells);
          end++;
        }
        const tableEnd = lines.end(end - 1);
        tokens.push(BlockKind.TableClose, tableEnd, tableEnd);
        return end;
      },
    ],
    builds: [
      {
        token: BlockKind.TableCellOpen,
        build: buildTableCell,
      },
      {
        token: BlockKind.TableRowOpen,
        build: buildTableRow,
      },
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
          const rows = buildBlockChildren<TableRow>(tokenStart, context);
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
