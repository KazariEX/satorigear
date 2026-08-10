import type { AlignType, Table, TableCell, TableRow } from "mdast";
import { type BlockLine, isBlank, lineIndent } from "../../block/lines.ts";
import { type BlockToken, namedToken, structuralToken, tokenStart } from "../../block/tokens.ts";
import {
  type BlockProjectionContext,
  blockToken,
  inlineChildren,
  withSpan,
} from "../../mdast.ts";
import { projectCodeSpan } from "./code.ts";
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

type AlignmentToken =
  | "TableAlignNone"
  | "TableAlignLeft"
  | "TableAlignRight"
  | "TableAlignCenter";

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

function alignmentAt(source: string, cell: CellRange): AlignmentToken | undefined {
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
    ? right ? "TableAlignCenter" : "TableAlignLeft"
    : right ? "TableAlignRight" : "TableAlignNone";
}

function delimiterAt(source: string, line: BlockLine): { cells: CellRange[]; tokens: AlignmentToken[] } | undefined {
  const cells = tableCellsAt(source, line, false);
  if (!cells) {
    return;
  }
  const tokens: AlignmentToken[] = [];
  for (const cell of cells) {
    const alignment = alignmentAt(source, cell);
    if (!alignment) {
      return;
    }
    tokens.push(alignment);
  }
  return { cells, tokens };
}

function emitTableRow(source: string, line: BlockLine, cells: readonly CellRange[], out: BlockToken[]): void {
  out.push(structuralToken("TableRowOpen", cells[0].start));
  for (const cell of cells) {
    out.push(structuralToken("TableCellOpen", cell.start));
    if (cell.contentEnd > cell.contentStart) {
      out.push(namedToken(
        "InlineChunk",
        source.slice(cell.contentStart, cell.contentEnd),
        cell.contentStart,
      ));
    }
    out.push(structuralToken("TableCellClose", cell.end));
  }
  out.push(structuralToken("TableRowClose", line.end));
}

function childRules(
  nodeId: number,
  offset: number,
  tokenBase: number,
  rule: string,
  context: BlockProjectionContext,
): RuleLocation[] {
  const arena = context.view.arena;
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

function projectCell(
  nodeId: number,
  offset: number,
  tokenBase: number,
  context: BlockProjectionContext,
): TableCell {
  const open = blockToken(nodeId, tokenBase, "TableCellOpen", context);
  const close = blockToken(nodeId, tokenBase, "TableCellClose", context);
  return withSpan<TableCell>({
    type: "tableCell",
    children: inlineChildren(nodeId, context, true),
  }, tokenStart(open), tokenStart(close));
}

function projectRow(
  nodeId: number,
  offset: number,
  tokenBase: number,
  context: BlockProjectionContext,
): TableRow {
  const open = blockToken(nodeId, tokenBase, "TableRowOpen", context);
  const close = blockToken(nodeId, tokenBase, "TableRowClose", context);
  const children = childRules(nodeId, offset, tokenBase, "TableCell", context).map((cell) => (
    projectCell(cell.id, cell.offset, cell.tokenBase, context)
  ));
  return withSpan<TableRow>({ type: "tableRow", children }, tokenStart(open), tokenStart(close));
}

function tableAlignment(
  nodeId: number,
  tokenBase: number,
  context: BlockProjectionContext,
): AlignType[] {
  const arena = context.view.arena;
  const result: AlignType[] = [];
  for (let index = 0; index < arena.childCount(nodeId); index++) {
    const child = arena.childAt(nodeId, index);
    if (child >= 0) {
      continue;
    }
    const type = arena.leafTokenType(child, tokenBase);
    result.push(
      type === "TableAlignLeft"
        ? "left"
        : type === "TableAlignRight"
          ? "right"
          : type === "TableAlignCenter" ? "center" : null,
    );
  }
  return result;
}

export const feature: SyntaxFeature = {
  blockFallbacks: [
    (source, lines, start, out, contentOffset, context) => {
      const delimiterLine = lines[start + 1];
      if (!delimiterLine || context.startsInterruptingBlock(source, delimiterLine)) {
        return;
      }
      const delimiter = delimiterAt(source, delimiterLine);
      const header = delimiter ? tableCellsAt(source, lines[start], true) : void 0;
      if (!header || !delimiter || header.length !== delimiter.cells.length) {
        return;
      }

      out.push(structuralToken("TableOpen", header[0].start));
      emitTableRow(source, lines[start], header, out);
      for (let index = 0; index < delimiter.cells.length; index++) {
        const cell = delimiter.cells[index];
        out.push(namedToken(
          delimiter.tokens[index],
          source.slice(cell.start, cell.end),
          cell.start,
        ));
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
        emitTableRow(source, line, cells, out);
        end++;
      }
      out.push(structuralToken("TableClose", lines[end - 1].end));
      return end;
    },
  ],
  blockRules: [
    {
      rule: "TableCell",
      inlineContent: true,
    },
    {
      rule: "Table",
      project(nodeId, offset, tokenBase, context) {
        const open = blockToken(nodeId, tokenBase, "TableOpen", context);
        const close = blockToken(nodeId, tokenBase, "TableClose", context);
        const rows = childRules(nodeId, offset, tokenBase, "TableRow", context).map((row) => (
          projectRow(row.id, row.offset, row.tokenBase, context)
        ));
        const delimiter = childRules(nodeId, offset, tokenBase, "TableDelimiter", context)[0];
        if (!delimiter) {
          throw new Error("Table syntax does not contain a delimiter");
        }
        return withSpan<Table>({
          type: "table",
          align: tableAlignment(delimiter.id, delimiter.tokenBase, context),
          children: rows,
        }, tokenStart(open), tokenStart(close));
      },
    },
  ],
  inlineTokens: [
    {
      token: "CodeSpan",
      project(tokenIndex, sourceSpan, accumulator) {
        // GFM removes a pipe escape inside table code spans, while CommonMark code spans preserve it.
        return projectCodeSpan(
          tokenIndex,
          sourceSpan,
          accumulator,
          accumulator.context.blockRule === "TableCell",
        );
      },
    },
  ],
};
