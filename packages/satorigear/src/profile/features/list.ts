import type { List, ListItem } from "mdast";
import {
  type BlockLine,
  contentAfterColumns,
  indentOf,
  isBlank,
  lineIndent,
} from "../../block/lines.ts";
import { noBlockEntry } from "../../block/structure.ts";
import { BlockKind, BlockRule } from "../../constants/block.ts";
import { Character } from "../../constants/character.ts";
import {
  type BlockBuildContext,
  blockEnd,
  type BlockNodeBuilder,
  blockToken,
  buildBlockChildren,
  payloadBounds,
} from "../../fragment/block.ts";
import { lastChildEnd, type SpannedNode } from "../../fragment/node.ts";
import { isThematicBreak } from "./break.ts";
import type { BlockStart } from "../../block/profile.ts";
import type { BlockTokenStream } from "../../block/tokens.ts";
import type { SourceSpan } from "../../source-view.ts";
import type { SyntaxFeature } from "../types.ts";

interface ListMarker {
  kind: "ordered" | "unordered";
  indent: number;
  offset: number;
  contentOffset: number;
  contentIndent: number;
  contentPrefixColumns: number;
  delimiter: string;
  text: string;
  startNumber?: number;
}

function listMarkerPadding(
  source: string,
  line: BlockLine,
  markerEnd: number,
  markerColumn: number,
): { offset: number; columns: number; prefixColumns: number } {
  if (markerEnd === line.end) {
    return { offset: markerEnd, columns: 1, prefixColumns: 0 };
  }
  let offset = markerEnd;
  let column = markerColumn;
  while (offset < line.end && (source[offset] === " " || source[offset] === "\t")) {
    column += source[offset] === "\t" ? 4 - (column % 4) : 1;
    offset++;
  }
  const whitespaceColumns = column - markerColumn;
  if (offset < line.end && whitespaceColumns <= 4) {
    return { offset, columns: whitespaceColumns, prefixColumns: 0 };
  }
  const consumedColumn = markerColumn + (source[markerEnd] === "\t" ? 4 - (markerColumn % 4) : 1);
  return { offset: markerEnd + 1, columns: 1, prefixColumns: Math.max(0, consumedColumn - markerColumn - 1) };
}

function listMarkerAt(source: string, line: BlockLine): ListMarker | undefined {
  const indent = lineIndent(source, line);
  if (!indent) {
    return;
  }
  const marker = source[indent.offset];
  const markerEnd = indent.offset + 1;
  if (
    (marker === "-" || marker === "+" || marker === "*") &&
    (markerEnd === line.end || source[markerEnd] === " " || source[markerEnd] === "\t") &&
    !isThematicBreak(source, line, indent.offset)
  ) {
    const padding = listMarkerPadding(source, line, markerEnd, indent.columns + 1);
    return {
      kind: "unordered",
      indent: indent.columns,
      offset: indent.offset,
      contentOffset: padding.offset,
      contentIndent: indent.columns + 1 + padding.columns,
      contentPrefixColumns: padding.prefixColumns,
      delimiter: marker,
      text: marker,
    };
  }
  const markerCode = source.charCodeAt(indent.offset);
  if (markerCode < Character.DigitZero || markerCode > Character.DigitNine) {
    return;
  }
  let startNumber = 0;
  let orderedEnd = indent.offset;
  // CommonMark caps ordered markers at nine digits, so the prefix is cheaper to scan than to slice and match.
  while (orderedEnd < line.end && orderedEnd - indent.offset < 9) {
    const digit = source.charCodeAt(orderedEnd) - Character.DigitZero;
    if (digit < 0 || digit > 9) {
      break;
    }
    startNumber = startNumber * 10 + digit;
    orderedEnd++;
  }
  const delimiter = source[orderedEnd];
  if (
    delimiter !== "." && delimiter !== ")" || (
      orderedEnd + 1 < line.end &&
      source[orderedEnd + 1] !== " " &&
      source[orderedEnd + 1] !== "\t"
    )
  ) {
    return;
  }
  orderedEnd++;
  const markerWidth = orderedEnd - indent.offset;
  const padding = listMarkerPadding(source, line, orderedEnd, indent.columns + markerWidth);
  return {
    kind: "ordered",
    indent: indent.columns,
    offset: indent.offset,
    contentOffset: padding.offset,
    contentIndent: indent.columns + markerWidth + padding.columns,
    contentPrefixColumns: padding.prefixColumns,
    delimiter,
    text: source.slice(indent.offset, orderedEnd),
    startNumber,
  };
}

function sameList(a: ListMarker, b: ListMarker): boolean {
  return a.kind === b.kind && a.delimiter === b.delimiter;
}

function hasListContent(source: string, line: BlockLine, marker: ListMarker | undefined): boolean {
  return !!marker && /\S/.test(source.slice(marker.contentOffset, line.end));
}

function hasBlankLineBetween(source: string, start: number, end: number, stripBlockQuotes: boolean): boolean {
  let lineEnd = Math.max(0, start - 1);
  // Child spans may end and begin mid-line; only complete physical lines between them determine spread.
  while (lineEnd < end && source[lineEnd] !== "\n" && source[lineEnd] !== "\r") {
    lineEnd++;
  }

  while (lineEnd < end) {
    let contentStart = lineEnd + (source[lineEnd] === "\r" && source[lineEnd + 1] === "\n" ? 2 : 1);
    if (stripBlockQuotes) {
      while (contentStart < end) {
        let marker = contentStart;
        for (let spaces = 0; spaces < 3 && source[marker] === " "; spaces++) {
          marker++;
        }
        if (source[marker] !== ">") {
          break;
        }
        contentStart = marker + 1;
        if (source[contentStart] === " " || source[contentStart] === "\t") {
          contentStart++;
        }
      }
    }
    while (contentStart < end && (source[contentStart] === " " || source[contentStart] === "\t")) {
      contentStart++;
    }
    if (contentStart === end) {
      return false;
    }
    if (source[contentStart] === "\n" || source[contentStart] === "\r") {
      return true;
    }
    lineEnd = contentStart + 1;
    while (lineEnd < end && source[lineEnd] !== "\n" && source[lineEnd] !== "\r") {
      lineEnd++;
    }
  }
  return false;
}

interface TaskListMarker {
  checked: boolean;
  contentStart: number;
}

function isTaskListWhitespace(code: number): boolean {
  return code === Character.Space || (
    code >= Character.CharacterTabulation && code <= Character.CarriageReturn
  );
}

function taskListMarkerAt(source: string, start: number, end: number): TaskListMarker | undefined {
  while (source.charCodeAt(start) === Character.Space) {
    start++;
  }
  if (source.charCodeAt(start++) !== Character.LeftSquareBracket) {
    return;
  }
  const state = source.charCodeAt(start++);
  const checked = state === Character.LatinCapitalLetterX || state === Character.LatinSmallLetterX;
  if (!checked && !isTaskListWhitespace(state)) {
    return;
  }
  if (source.charCodeAt(start++) !== Character.RightSquareBracket) {
    return;
  }
  if (start >= end) {
    return;
  }
  const whitespace = source.charCodeAt(start++);
  if (!isTaskListWhitespace(whitespace)) {
    return;
  }
  if (
    whitespace === Character.CarriageReturn &&
    source.charCodeAt(start) === Character.LineFeed
  ) {
    start++;
  }
  return {
    checked,
    contentStart: start,
  };
}

function hasTaskListContent(
  source: string,
  tokens: BlockTokenStream,
  firstChunk: number,
  contentStart: number,
): boolean {
  for (let token = firstChunk; tokens.kind(token) === BlockKind.InlineChunk; token++) {
    const start = token === firstChunk ? contentStart : tokens.start(token);
    const end = tokens.end(token);
    for (let offset = start; offset < end; offset++) {
      if (!isTaskListWhitespace(source.charCodeAt(offset))) {
        return true;
      }
    }
  }
  return false;
}

function childrenSpread(
  tokenStart: number,
  stripBlockQuotes: boolean,
  context: BlockBuildContext,
  nestedRule?: BlockRule,
): boolean {
  const structure = context.structure;
  let previous: SourceSpan | undefined;
  for (
    let childId = structure.firstChild(tokenStart);
    childId !== noBlockEntry;
    childId = structure.nextChild(tokenStart, childId)
  ) {
    if (
      childId >= 0 && (
        nestedRule === void 0
          ? structure.isBlock(childId)
          : structure.isRule(childId, nestedRule)
      )
    ) {
      const current = payloadBounds(childId, context);
      if (previous && hasBlankLineBetween(context.source, previous.end, current.start, stripBlockQuotes)) {
        return true;
      }
      previous = current;
    }
  }
  return false;
}

const buildListItem: BlockNodeBuilder<ListItem> = (tokenStart, context) => {
  const markerKind = context.structure.tokens.kind(tokenStart);
  const children = buildBlockChildren(tokenStart, context);
  return {
    type: "listItem",
    spread: childrenSpread(tokenStart, true, context),
    checked: markerKind === BlockKind.CheckedTaskItemOpen
      ? true
      : markerKind === BlockKind.UncheckedTaskItemOpen ? false : null,
    children,
    position: {
      start: context.structure.tokens.start(tokenStart),
      end: lastChildEnd(children, blockEnd(tokenStart, context)),
    },
  };
};

function createBuildList(ordered: boolean): BlockNodeBuilder<List> {
  return (tokenStart, context) => {
    const structure = context.structure;
    const listMarker = blockToken(
      tokenStart,
      ordered ? BlockKind.OrderedListOpen : BlockKind.UnorderedListOpen,
      context,
    );
    const items: SpannedNode<ListItem>[] = [];
    for (
      let childId = structure.firstChild(tokenStart);
      childId !== noBlockEntry;
      childId = structure.nextChild(tokenStart, childId)
    ) {
      if (childId >= 0 && structure.isRule(childId, BlockRule.ListItem)) {
        items.push(buildListItem(childId, context));
      }
    }
    return {
      type: "list",
      ordered,
      start: ordered ? Number.parseInt(context.structure.tokens.text(context.source, listMarker), 10) : null,
      spread: childrenSpread(tokenStart, false, context, BlockRule.ListItem),
      children: items,
      position: {
        start: context.structure.tokens.start(listMarker),
        end: lastChildEnd(items, context.structure.tokens.end(listMarker)),
      },
    };
  };
}

const listStart: BlockStart = (source, lines, start, out, contentOffset, context) => {
  const listMarker = listMarkerAt(source, lines[start]);
  if (!listMarker) {
    return;
  }
  const kind = listMarker.kind;
  const listOpen = kind === "ordered" ? BlockKind.OrderedListOpen : BlockKind.UnorderedListOpen;
  const listClose = kind === "ordered" ? BlockKind.OrderedListClose : BlockKind.UnorderedListClose;
  out.push(listOpen, listMarker.offset, listMarker.offset + listMarker.text.length);
  let index = start;
  let listEnd = listMarker.offset + listMarker.text.length;
  while (index < lines.length) {
    const marker = listMarkerAt(source, lines[index]);
    if (!marker || !sameList(marker, listMarker)) {
      break;
    }
    out.push(BlockKind.ListItemOpen, marker.offset, marker.offset + marker.text.length);
    const itemLines: BlockLine[] = [{
      ...lines[index],
      start: marker.contentOffset,
      prefixColumns: marker.contentPrefixColumns,
    }];
    let hasContent = !isBlank(source, itemLines[0]);
    let lazyParagraph = context.endsWithParagraphLeaf(source, itemLines[0]);
    index++;
    while (index < lines.length) {
      const candidate = listMarkerAt(source, lines[index]);
      if (candidate && candidate.indent < marker.contentIndent) {
        break;
      }
      if (isBlank(source, lines[index])) {
        if (!hasContent) {
          index++;
          break;
        }
        itemLines.push(lines[index]);
        lazyParagraph = false;
        index++;
        continue;
      }
      const indent = indentOf(source, lines[index]);
      if (indent.columns >= marker.contentIndent) {
        const content = contentAfterColumns(source, lines[index], marker.contentIndent);
        const contentLine = { ...lines[index], start: content.offset, prefixColumns: content.prefixColumns };
        itemLines.push(contentLine);
        hasContent = true;
        lazyParagraph = context.endsWithParagraphLeaf(source, contentLine);
        index++;
        continue;
      }
      if (!lazyParagraph || context.startsInterruptingBlock(source, lines[index])) {
        break;
      }
      itemLines.push({ ...lines[index], lazy: true });
      index++;
    }
    context.scanLines(source, itemLines, out);
    listEnd = itemLines.at(-1)?.next ?? marker.offset;
    out.push(BlockKind.ListItemClose, listEnd, listEnd);
  }
  out.push(listClose, listEnd, listEnd);
  return index;
};

const taskListStart: BlockStart = (source, lines, start, out, contentOffset, context) => {
  const listTokenStart = out.length;
  const nextLine = listStart(source, lines, start, out, contentOffset, context);
  if (nextLine === void 0) {
    return;
  }
  // The list window is complete but not indexed yet, so task semantics can refine it in place.
  for (let item = listTokenStart + 1; item < out.length; item++) {
    if (out.kind(item) !== BlockKind.ListItemOpen) {
      continue;
    }
    let paragraph = item + 1;
    let contentKind = out.kind(paragraph);
    // Link definition tokens are contiguous and do not count as the item's first content block.
    while (
      contentKind === BlockKind.LinkDefinitionOpen ||
      contentKind === BlockKind.LinkDefinitionChunk ||
      contentKind === BlockKind.LinkDefinitionClose
    ) {
      paragraph++;
      contentKind = out.kind(paragraph);
    }
    if (contentKind !== BlockKind.ParagraphOpen) {
      continue;
    }
    const firstChunk = paragraph + 1;
    const marker = taskListMarkerAt(
      source,
      out.start(firstChunk),
      out.end(firstChunk),
    );
    if (!marker || !hasTaskListContent(source, out, firstChunk, marker.contentStart)) {
      continue;
    }
    out.setKind(
      item,
      marker.checked ? BlockKind.CheckedTaskItemOpen : BlockKind.UncheckedTaskItemOpen,
    );
    out.setStart(firstChunk, marker.contentStart);
  }
  return nextLine;
};

export function feature(taskList = false): SyntaxFeature {
  return {
    block: {
      rules: [
        {
          rule: BlockRule.ListItem,
          syntax: {
            kind: "frame",
            open: [
              BlockKind.ListItemOpen,
              BlockKind.UncheckedTaskItemOpen,
              BlockKind.CheckedTaskItemOpen,
            ],
            close: BlockKind.ListItemClose,
          },
        },
        {
          rule: BlockRule.UnorderedList,
          syntax: {
            kind: "block",
            open: BlockKind.UnorderedListOpen,
            close: BlockKind.UnorderedListClose,
          },
          build: createBuildList(false),
        },
        {
          rule: BlockRule.OrderedList,
          syntax: {
            kind: "block",
            open: BlockKind.OrderedListOpen,
            close: BlockKind.OrderedListClose,
          },
          build: createBuildList(true),
        },
      ],
      starts: [
        {
          codes: [
            Character.Asterisk,
            Character.PlusSign,
            Character.HyphenMinus,
            Character.DigitZero,
            Character.DigitOne,
            Character.DigitTwo,
            Character.DigitThree,
            Character.DigitFour,
            Character.DigitFive,
            Character.DigitSix,
            Character.DigitSeven,
            Character.DigitEight,
            Character.DigitNine,
          ],
          unwrapLazyContinuation(source, line) {
            const marker = listMarkerAt(source, line);
            return marker
              ? { ...line, start: marker.contentOffset, prefixColumns: marker.contentPrefixColumns }
              : void 0;
          },
          interrupt(source, line) {
            const marker = listMarkerAt(source, line);
            return hasListContent(source, line, marker) && (
              marker?.kind === "unordered" ||
            marker?.kind === "ordered" && marker.startNumber === 1
            );
          },
          start: taskList ? taskListStart : listStart,
        },
      ],
    },
  };
}
