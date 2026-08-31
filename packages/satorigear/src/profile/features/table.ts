import type { AlignType, TableCell, TableRow } from "mdast";
import { type BlockLines, lineIndentOffset } from "../../block/lines.ts";
import { BlockKind, BlockRule, BlockTokenRole } from "../../constants/block.ts";
import { Character } from "../../constants/character.ts";
import { type BlockBuildContext, type BlockNodeBuilder, buildBlockNode } from "../../fragment/block.ts";
import { buildInlineFragment } from "../../fragment/inline.ts";
import type { BlockTokenStream } from "../../block/tokens.ts";
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
  while (contentStart < contentEnd) {
    const code = source.charCodeAt(contentStart);
    if (code !== Character.Space && code !== Character.CharacterTabulation) {
      break;
    }
    contentStart++;
  }
  while (contentEnd > contentStart) {
    const code = source.charCodeAt(contentEnd - 1);
    if (code !== Character.Space && code !== Character.CharacterTabulation) {
      break;
    }
    contentEnd--;
  }
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

  const pipes: number[] = [];
  let backslashes = 0;
  const lineEnd = lines.end(index);
  for (let offset = contentOffset; offset < lineEnd; offset++) {
    const code = source.charCodeAt(offset);
    if (code === Character.ReverseSolidus) {
      backslashes++;
      continue;
    }
    if (code === Character.VerticalLine && backslashes % 2 === 0) {
      pipes.push(offset);
    }
    backslashes = 0;
  }
  if (requirePipe && pipes.length === 0) {
    return;
  }

  let visibleEnd = lineEnd;
  while (visibleEnd > contentOffset) {
    const code = source.charCodeAt(visibleEnd - 1);
    if (code !== Character.Space && code !== Character.CharacterTabulation) {
      break;
    }
    visibleEnd--;
  }
  const trailingPipe = pipes.at(-1) === visibleEnd - 1;
  const leadingPipe = pipes[0] === contentOffset;
  const cells: number[] = [];
  let contentStart = contentOffset;
  let spanStart = contentOffset;
  let pipeIndex = 0;
  if (leadingPipe) {
    contentStart++;
    pipeIndex++;
  }
  for (; pipeIndex < pipes.length; pipeIndex++) {
    const pipe = pipes[pipeIndex];
    appendTableCell(cells, source, spanStart, contentStart, pipe);
    spanStart = pipe;
    contentStart = pipe + 1;
  }
  if (!trailingPipe) {
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
  if (start === end) {
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
  index: number,
  cells: readonly number[],
  out: BlockTokenStream,
): void {
  out.push(BlockKind.TableRowOpen, cells[0], cells[0]);
  for (let cell = 0; cell < cells.length; cell += CellSlot.Stride) {
    // The possibly empty inline chunk closes the cell frame. The next cell or
    // row-close token marks its outer end, so no separate close token is needed.
    const start = cells[cell];
    out.push(BlockKind.TableCellStart, start, start);
    out.push(
      BlockKind.InlineChunk,
      cells[cell + CellSlot.ContentStart],
      cells[cell + CellSlot.ContentEnd],
      void 0,
      BlockTokenRole.Close,
    );
  }
  const lineEnd = lines.end(index);
  out.push(BlockKind.TableRowClose, lineEnd, lineEnd);
}

const buildTableCell: BlockNodeBuilder<TableCell> = (tokenStart, context) => {
  const tokens = context.structure.tokens;
  const start = context.locator.locationAt(tokens.start(tokenStart));
  const children = buildInlineFragment(tokenStart, BlockRule.TableCell, context).children;
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
  const children: TableCell[] = [];
  for (let cell = tokenStart + 1; cell < close; cell += tokens.nodeLength(cell)) {
    children.push(buildBlockNode(cell, context));
  }
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
  const tokenEnd = tokenStart + tokens.nodeLength(tokenStart);
  const result: AlignType[] = [];
  for (let token = tokenStart; token < tokenEnd; token++) {
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
      (source, lines, start, contentOffset, out, context) => {
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

        out.push(BlockKind.TableOpen, header[0], header[0]);
        emitTableRow(lines, start, header, out);
        const delimiterEnd = lines.end(delimiterLine);
        for (let cell = 0; cell < delimiter.length; cell += CellSlot.Stride) {
          out.push(
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
          emitTableRow(lines, end, cells, out);
          end++;
        }
        const tableEnd = lines.end(end - 1);
        out.push(BlockKind.TableClose, tableEnd, tableEnd);
        return end;
      },
    ],
    rules: [
      {
        rule: BlockRule.TableCell,
        syntax: {
          kind: "frame",
          token: BlockKind.TableCellStart,
        },
        inlineContent: true,
        build: buildTableCell,
      },
      {
        rule: BlockRule.TableRow,
        syntax: {
          kind: "frame",
          token: BlockKind.TableRowOpen,
        },
        build: buildTableRow,
      },
      {
        rule: BlockRule.TableDelimiter,
        syntax: {
          kind: "group",
          token: [
            BlockKind.TableAlignNone,
            BlockKind.TableAlignLeft,
            BlockKind.TableAlignRight,
            BlockKind.TableAlignCenter,
          ],
        },
      },
      {
        rule: BlockRule.Table,
        syntax: {
          kind: "block",
          token: BlockKind.TableOpen,
        },
        build(tokenStart, context) {
          const tokens = context.structure.tokens;
          const close = tokenStart + tokens.nodeLength(tokenStart) - 1;
          const start = context.locator.locationAt(tokens.start(tokenStart));
          // Tables are emitted as a header row, delimiter group, then body rows.
          const header = tokenStart + 1;
          const delimiter = header + tokens.nodeLength(header);
          const rows = [buildBlockNode<TableRow>(header, context)];
          for (
            let row = delimiter + tokens.nodeLength(delimiter);
            row < close;
            row += tokens.nodeLength(row)
          ) {
            rows.push(buildBlockNode(row, context));
          }
          return {
            type: "table",
            align: tableAlignment(delimiter, context),
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
