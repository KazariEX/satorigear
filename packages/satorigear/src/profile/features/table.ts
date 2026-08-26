import type { AlignType, TableCell, TableRow } from "mdast";
import { type BlockLine, isBlank, lineIndentOffset } from "../../block/lines.ts";
import { BlockKind, BlockRule } from "../../constants/block.ts";
import { buildInlineFragment } from "../../fragment/inline.ts";
import type { BlockTokenStream } from "../../block/tokens.ts";
import type { BlockBuildContext, BlockNodeBuilder } from "../../fragment/block.ts";
import type { SpannedNode } from "../../fragment/node.ts";
import type { SyntaxFeature } from "../types.ts";

// Cell records start as [frame start, trimmed content start, trimmed content end].
// Delimiter validation reuses the content-start slot for its alignment kind.
const enum CellSlot {
  ContentStart = 1,
  // eslint-disable-next-line ts/prefer-literal-enum-member
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
  while (contentStart < contentEnd && (source[contentStart] === " " || source[contentStart] === "\t")) {
    contentStart++;
  }
  while (contentEnd > contentStart && (source[contentEnd - 1] === " " || source[contentEnd - 1] === "\t")) {
    contentEnd--;
  }
  cells.push(start, contentStart, contentEnd);
}

function tableCellsAt(
  source: string,
  line: BlockLine,
  requirePipe: boolean,
  contentOffset = lineIndentOffset(source, line),
): number[] | undefined {
  if (contentOffset < 0) {
    return;
  }

  const pipes: number[] = [];
  let backslashes = 0;
  for (let offset = contentOffset; offset < line.end; offset++) {
    const character = source[offset];
    if (character === "\\") {
      backslashes++;
      continue;
    }
    if (character === "|" && backslashes % 2 === 0) {
      pipes.push(offset);
    }
    backslashes = 0;
  }
  if (requirePipe && pipes.length === 0) {
    return;
  }

  let visibleEnd = line.end;
  while (visibleEnd > contentOffset && (source[visibleEnd - 1] === " " || source[visibleEnd - 1] === "\t")) {
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
    appendTableCell(cells, source, spanStart, contentStart, line.end);
  }
  return cells.length > 0 ? cells : void 0;
}

function alignmentAt(source: string, cells: readonly number[], cell: number): BlockKind | undefined {
  let start = cells[cell + CellSlot.ContentStart];
  let end = cells[cell + CellSlot.ContentEnd];
  const left = source[start] === ":";
  if (left) {
    start++;
  }
  const right = source[end - 1] === ":";
  if (right) {
    end--;
  }
  if (start === end) {
    return;
  }
  for (let offset = start; offset < end; offset++) {
    if (source[offset] !== "-") {
      return;
    }
  }
  return left
    ? right ? BlockKind.TableAlignCenter : BlockKind.TableAlignLeft
    : right ? BlockKind.TableAlignRight : BlockKind.TableAlignNone;
}

function delimiterAt(source: string, line: BlockLine): number[] | undefined {
  const contentOffset = lineIndentOffset(source, line);
  if (contentOffset < 0) {
    return;
  }
  const first = source[contentOffset];
  if (first !== "-" && first !== ":" && first !== "|") {
    return;
  }
  const cells = tableCellsAt(source, line, false, contentOffset);
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

function emitTableRow(line: BlockLine, cells: readonly number[], out: BlockTokenStream): void {
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
    );
  }
  out.push(BlockKind.TableRowClose, line.end, line.end);
}

const buildTableCell: BlockNodeBuilder<TableCell> = (tokenStart, context, inline) => {
  const tokens = context.structure.tokens;
  return {
    type: "tableCell",
    children: inline!.children,
    position: {
      start: tokens.start(tokenStart),
      end: tokens.start(tokenStart + tokens.nodeLength(tokenStart)),
    },
  };
};

const buildTableRow: BlockNodeBuilder<TableRow> = (tokenStart, context) => {
  const tokens = context.structure.tokens;
  const close = tokenStart + tokens.nodeLength(tokenStart) - 1;
  const children: SpannedNode<TableCell>[] = [];
  for (let cell = tokenStart + 1; cell < close; cell += tokens.nodeLength(cell)) {
    children.push(buildTableCell(
      cell,
      context,
      buildInlineFragment(cell, BlockRule.TableCell, context),
    ));
  }
  return {
    type: "tableRow",
    children,
    position: {
      start: tokens.start(tokenStart),
      end: tokens.start(close),
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
      (source, lines, start, out, context) => {
        const delimiterLine = lines[start + 1];
        if (!delimiterLine || context.startsInterruptingBlock(source, delimiterLine)) {
          return;
        }
        const delimiter = delimiterAt(source, delimiterLine);
        if (!delimiter) {
          return;
        }
        const header = tableCellsAt(source, lines[start], true);
        if (header?.length !== delimiter.length) {
          return;
        }

        out.push(BlockKind.TableOpen, header[0], header[0]);
        emitTableRow(lines[start], header, out);
        for (let cell = 0; cell < delimiter.length; cell += CellSlot.Stride) {
          out.push(
            delimiter[cell + CellSlot.Alignment],
            delimiter[cell],
            delimiter[cell + CellSlot.Stride] ?? delimiterLine.end,
          );
        }

        let end = start + 2;
        while (end < lines.length) {
          const line = lines[end];
          if (
            isBlank(source, line) ||
            lineIndentOffset(source, line) < 0 ||
            context.startsInterruptingBlock(source, line)
          ) {
            break;
          }
          const cells = tableCellsAt(source, line, false);
          if (!cells) {
            break;
          }
          emitTableRow(line, cells, out);
          end++;
        }
        out.push(BlockKind.TableClose, lines[end - 1].end, lines[end - 1].end);
        return end;
      },
    ],
    rules: [
      {
        rule: BlockRule.TableCell,
        syntax: {
          kind: "frame",
          open: BlockKind.TableCellStart,
          close: BlockKind.InlineChunk,
        },
        inlineContent: true,
      },
      {
        rule: BlockRule.TableRow,
        syntax: {
          kind: "frame",
          open: BlockKind.TableRowOpen,
          close: BlockKind.TableRowClose,
        },
      },
      {
        rule: BlockRule.TableDelimiter,
        syntax: {
          kind: "group",
          tokens: [
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
          open: BlockKind.TableOpen,
          close: BlockKind.TableClose,
        },
        build(tokenStart, context) {
          const tokens = context.structure.tokens;
          const close = tokenStart + tokens.nodeLength(tokenStart) - 1;
          // Tables are emitted as a header row, delimiter group, then body rows.
          const header = tokenStart + 1;
          const delimiter = header + tokens.nodeLength(header);
          const rows = [buildTableRow(header, context)];
          for (
            let row = delimiter + tokens.nodeLength(delimiter);
            row < close;
            row += tokens.nodeLength(row)
          ) {
            rows.push(buildTableRow(row, context));
          }
          return {
            type: "table",
            align: tableAlignment(delimiter, context),
            children: rows,
            position: {
              start: tokens.start(tokenStart),
              end: tokens.start(close),
            },
          };
        },
      },
    ],
  },
};
