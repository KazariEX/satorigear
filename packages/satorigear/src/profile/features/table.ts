import type { AlignType, TableCell, TableRow } from "mdast";
import { noBlockEntry } from "../../block/arena.ts";
import { BlockKind } from "../../block/kinds.ts";
import { type BlockLine, isBlank, lineIndent } from "../../block/lines.ts";
import { type BlockBuildContext, type BlockNodeBuilder, blockToken } from "../../fragment/block.ts";
import { buildInlineChildren } from "../../fragment/inline.ts";
import type { BlockTokenStream } from "../../block/tokens.ts";
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
    out.push(BlockKind.TableCellOpen, cell.start, cell.start);
    if (cell.contentEnd > cell.contentStart) {
      out.push(BlockKind.InlineChunk, cell.contentStart, cell.contentEnd);
    }
    out.push(BlockKind.TableCellClose, cell.end, cell.end);
  }
  out.push(BlockKind.TableRowClose, line.end, line.end);
}

function childRules(
  tokenStart: number,
  rule: string,
  context: BlockBuildContext,
): number[] {
  const arena = context.arena;
  const result: number[] = [];
  for (
    let child = arena.firstChild(tokenStart);
    child !== noBlockEntry;
    child = arena.nextChild(tokenStart, child)
  ) {
    if (child >= 0 && arena.ruleNameOf(child) === rule) {
      result.push(child);
    }
  }
  return result;
}

const buildTableCell: BlockNodeBuilder<TableCell> = (tokenStart, context) => {
  const open = blockToken(tokenStart, BlockKind.TableCellOpen, context);
  const close = blockToken(tokenStart, BlockKind.TableCellClose, context);
  return {
    type: "tableCell",
    children: buildInlineChildren(tokenStart, context, true),
    position: {
      start: context.arena.tokens.start(open),
      end: context.arena.tokens.start(close),
    },
  };
};

const buildTableRow: BlockNodeBuilder<TableRow> = (tokenStart, context) => {
  const open = blockToken(tokenStart, BlockKind.TableRowOpen, context);
  const close = blockToken(tokenStart, BlockKind.TableRowClose, context);
  const children = childRules(tokenStart, "TableCell", context).map((cell) => (
    buildTableCell(cell, context)
  ));
  return {
    type: "tableRow",
    children,
    position: {
      start: context.arena.tokens.start(open),
      end: context.arena.tokens.start(close),
    },
  };
};

function tableAlignment(
  tokenStart: number,
  context: BlockBuildContext,
): AlignType[] {
  const arena = context.arena;
  const result: AlignType[] = [];
  for (
    let child = arena.firstChild(tokenStart);
    child !== noBlockEntry;
    child = arena.nextChild(tokenStart, child)
  ) {
    if (child >= 0) {
      continue;
    }
    const kind = arena.tokens.kind(arena.leafToken(child));
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
        rule: "TableCell",
        syntax: {
          kind: "frame",
          open: BlockKind.TableCellOpen,
          close: BlockKind.TableCellClose,
        },
        inlineContent: true,
      },
      {
        rule: "TableRow",
        syntax: {
          kind: "frame",
          open: BlockKind.TableRowOpen,
          close: BlockKind.TableRowClose,
        },
      },
      {
        rule: "TableDelimiter",
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
        rule: "Table",
        syntax: {
          kind: "block",
          open: BlockKind.TableOpen,
          close: BlockKind.TableClose,
        },
        build(tokenStart, context) {
          const open = blockToken(tokenStart, BlockKind.TableOpen, context);
          const close = blockToken(tokenStart, BlockKind.TableClose, context);
          const rows = childRules(tokenStart, "TableRow", context).map((row) => (
            buildTableRow(row, context)
          ));
          const delimiter = childRules(tokenStart, "TableDelimiter", context)[0];
          if (!delimiter) {
            throw new Error("Table syntax does not contain a delimiter");
          }
          return {
            type: "table",
            align: tableAlignment(delimiter, context),
            children: rows,
            position: {
              start: context.arena.tokens.start(open),
              end: context.arena.tokens.start(close),
            },
          };
        },
      },
    ],
  },
};
