import type { AlignType, TableCell, TableRow } from "mdast";
import { BlockKind } from "../../block/kinds.ts";
import { type BlockLine, isBlank, lineIndent } from "../../block/lines.ts";
import { type BlockBuildContext, type BlockNodeBuilder, blockToken } from "../../fragment/block.ts";
import { buildInlineChildren } from "../../fragment/inline.ts";
import { InlineKind } from "../../inline/kinds.ts";
import { buildInlineCode } from "./code.ts";
import type { BlockTokenStream } from "../../block/tokens.ts";
import type { SyntaxFeature } from "../types.ts";

interface CellRange {
  contentEnd: number;
  contentStart: number;
  end: number;
  start: number;
}

interface RuleLocation {
  id: number;
  offset: number;
  tokenBase: number;
}

function trimCell(source: string, start: number, end: number): { end: number; start: number } {
  while (start < end && (source[start] === " " || source[start] === "\t")) {
    start++;
  }
  while (end > start && (source[end - 1] === " " || source[end - 1] === "\t")) {
    end--;
  }
  return { start, end };
}

function tableCellsAt(source: string, line: BlockLine, requirePipe: boolean): CellRange[] | undefined {
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
  const cells: CellRange[] = [];
  let contentStart = indent.offset;
  let spanStart = indent.offset;
  let pipeIndex = 0;
  if (leadingPipe) {
    contentStart++;
    pipeIndex++;
  }
  for (; pipeIndex < pipes.length; pipeIndex++) {
    const pipe = pipes[pipeIndex];
    const content = trimCell(source, contentStart, pipe);
    const trailing = trailingPipe && pipeIndex === pipes.length - 1;
    cells.push({
      contentStart: content.start,
      contentEnd: content.end,
      start: spanStart,
      end: trailing ? line.end : pipe,
    });
    spanStart = pipe;
    contentStart = pipe + 1;
  }
  if (!trailingPipe) {
    const content = trimCell(source, contentStart, line.end);
    cells.push({
      contentStart: content.start,
      contentEnd: content.end,
      start: spanStart,
      end: line.end,
    });
  }
  return cells.length > 0 ? cells : void 0;
}

function alignmentAt(source: string, cell: CellRange): BlockKind | undefined {
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

function delimiterAt(source: string, line: BlockLine): { cells: CellRange[]; tokens: BlockKind[] } | undefined {
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

function emitTableRow(line: BlockLine, cells: readonly CellRange[], out: BlockTokenStream): void {
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
  nodeId: number,
  offset: number,
  tokenBase: number,
  rule: string,
  context: BlockBuildContext,
): RuleLocation[] {
  const arena = context.arena;
  const result: RuleLocation[] = [];
  for (let index = 0; index < arena.childCount(nodeId); index++) {
    const child = arena.childAt(nodeId, index);
    if (child >= 0 && arena.ruleNameOf(child) === rule) {
      result.push({
        id: child,
        offset: offset + arena.childRelAt(nodeId, index),
        tokenBase: tokenBase + arena.childTokRelAt(nodeId, index),
      });
    }
  }
  return result;
}

const buildTableCell: BlockNodeBuilder<TableCell> = (nodeId, offset, tokenBase, context) => {
  const open = blockToken(nodeId, tokenBase, BlockKind.TableCellOpen, context);
  const close = blockToken(nodeId, tokenBase, BlockKind.TableCellClose, context);
  return {
    type: "tableCell",
    children: buildInlineChildren(nodeId, context, true),
    position: {
      start: context.arena.tokens.start(open),
      end: context.arena.tokens.start(close),
    },
  };
};

const buildTableRow: BlockNodeBuilder<TableRow> = (nodeId, offset, tokenBase, context) => {
  const open = blockToken(nodeId, tokenBase, BlockKind.TableRowOpen, context);
  const close = blockToken(nodeId, tokenBase, BlockKind.TableRowClose, context);
  const children = childRules(nodeId, offset, tokenBase, "TableCell", context).map((cell) => (
    buildTableCell(cell.id, cell.offset, cell.tokenBase, context)
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
  nodeId: number,
  tokenBase: number,
  context: BlockBuildContext,
): AlignType[] {
  const arena = context.arena;
  const result: AlignType[] = [];
  for (let index = 0; index < arena.childCount(nodeId); index++) {
    const child = arena.childAt(nodeId, index);
    if (child >= 0) {
      continue;
    }
    const kind = arena.leafTokenKind(child, tokenBase);
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
        build(nodeId, offset, tokenBase, context) {
          const open = blockToken(nodeId, tokenBase, BlockKind.TableOpen, context);
          const close = blockToken(nodeId, tokenBase, BlockKind.TableClose, context);
          const rows = childRules(nodeId, offset, tokenBase, "TableRow", context).map((row) => (
            buildTableRow(row.id, row.offset, row.tokenBase, context)
          ));
          const delimiter = childRules(nodeId, offset, tokenBase, "TableDelimiter", context)[0];
          if (!delimiter) {
            throw new Error("Table syntax does not contain a delimiter");
          }
          return {
            type: "table",
            align: tableAlignment(delimiter.id, delimiter.tokenBase, context),
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
  inline: {
    syntax: [
      {
        kind: "leaf",
        token: InlineKind.CodeSpan,
        // GFM removes a pipe escape inside table code spans, while CommonMark code spans preserve it.
        build: buildInlineCode,
      },
    ],
  },
};
