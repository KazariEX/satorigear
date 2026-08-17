import type { AlignType, TableCell, TableRow } from "mdast";
import { type BlockLine, isBlank, lineIndent } from "../../block/lines.ts";
import { BlockKind, BlockRule } from "../../constants/block.ts";
import { buildInlineFragment } from "../../fragment/inline.ts";
import type { BlockTokenStream } from "../../block/tokens.ts";
import type { BlockBuildContext, BlockNodeBuilder } from "../../fragment/block.ts";
import type { SpannedNode } from "../../fragment/node.ts";
import type { SourceSpan } from "../../source-view.ts";
import type { SyntaxFeature } from "../types.ts";

interface CellSpan extends SourceSpan {
  contentEnd: number;
  contentStart: number;
}

function tableCell(
  source: string,
  start: number,
  end: number,
  contentStart: number,
  contentEnd: number,
): CellSpan {
  while (contentStart < contentEnd && (source[contentStart] === " " || source[contentStart] === "\t")) {
    contentStart++;
  }
  while (contentEnd > contentStart && (source[contentEnd - 1] === " " || source[contentEnd - 1] === "\t")) {
    contentEnd--;
  }
  return { start, end, contentStart, contentEnd };
}

function tableCellsAt(source: string, line: BlockLine, requirePipe: boolean): CellSpan[] | undefined {
  const indent = lineIndent(source, line);
  if (!indent) {
    return;
  }

  const pipes: number[] = [];
  let backslashes = 0;
  for (let offset = indent.offset; offset < line.end; offset++) {
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
  while (visibleEnd > indent.offset && (source[visibleEnd - 1] === " " || source[visibleEnd - 1] === "\t")) {
    visibleEnd--;
  }
  const trailingPipe = pipes.at(-1) === visibleEnd - 1;
  const leadingPipe = pipes[0] === indent.offset;
  const cells: CellSpan[] = [];
  let contentStart = indent.offset;
  let spanStart = indent.offset;
  let pipeIndex = 0;
  if (leadingPipe) {
    contentStart++;
    pipeIndex++;
  }
  for (; pipeIndex < pipes.length; pipeIndex++) {
    const pipe = pipes[pipeIndex];
    const trailing = trailingPipe && pipeIndex === pipes.length - 1;
    cells.push(tableCell(source, spanStart, trailing ? line.end : pipe, contentStart, pipe));
    spanStart = pipe;
    contentStart = pipe + 1;
  }
  if (!trailingPipe) {
    cells.push(tableCell(source, spanStart, line.end, contentStart, line.end));
  }
  return cells.length > 0 ? cells : void 0;
}

function alignmentAt(source: string, cell: CellSpan): BlockKind | undefined {
  let start = cell.contentStart;
  let end = cell.contentEnd;
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

function delimiterAt(source: string, line: BlockLine): { cells: CellSpan[]; tokens: BlockKind[] } | undefined {
  const indent = lineIndent(source, line);
  if (!indent) {
    return;
  }
  const first = source[indent.offset];
  if (first !== "-" && first !== ":" && first !== "|") {
    return;
  }
  const cells = tableCellsAt(source, line, false);
  if (!cells) {
    return;
  }
  const tokens: BlockKind[] = [];
  for (const cell of cells) {
    const alignment = alignmentAt(source, cell);
    if (!alignment) {
      return;
    }
    tokens.push(alignment);
  }
  return { cells, tokens };
}

function emitTableRow(line: BlockLine, cells: readonly CellSpan[], out: BlockTokenStream): void {
  out.push(BlockKind.TableRowOpen, cells[0].start, cells[0].start);
  for (const cell of cells) {
    // The possibly empty inline chunk closes the cell frame. The next cell or
    // row-close token marks its outer end, so no separate close token is needed.
    out.push(BlockKind.TableCellStart, cell.start, cell.start);
    out.push(BlockKind.InlineChunk, cell.contentStart, cell.contentEnd);
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
    children.push(buildTableCell(cell, context, buildInlineFragment(cell, context)));
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
        const header = delimiter ? tableCellsAt(source, lines[start], true) : void 0;
        if (!header || !delimiter || header.length !== delimiter.cells.length) {
          return;
        }

        out.push(BlockKind.TableOpen, header[0].start, header[0].start);
        emitTableRow(lines[start], header, out);
        for (let index = 0; index < delimiter.cells.length; index++) {
          const cell = delimiter.cells[index];
          out.push(delimiter.tokens[index], cell.start, cell.end);
        }

        let end = start + 2;
        while (end < lines.length) {
          const line = lines[end];
          if (isBlank(source, line) || !lineIndent(source, line) || context.startsInterruptingBlock(source, line)) {
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
