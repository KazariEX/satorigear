import type { List, ListItem } from "mdast";
import { type BlockLines, IndentedLine, lineIndentOffset } from "../../block/lines.ts";
import { BlockKind } from "../../constants/block.ts";
import { Character } from "../../constants/character.ts";
import { type BlockNodeBuilder, buildBlockChildren } from "../../fragment/block.ts";
import { cloneLocation, type SourceLocation } from "../../source-view.ts";
import { isThematicBreak } from "./break.ts";
import type { BlockStart } from "../../block/profile.ts";
import type { BlockTokenStream } from "../../block/tokens.ts";
import type { SyntaxFeature } from "../types.ts";

interface ListMarker {
  offset: number;
  end: number;
  hasContent: boolean;
  contentOffset: number;
  contentIndent: number;
  contentPrefixColumns: number;
  delimiter: number;
  startNumber: number;
}

const enum ParagraphLeafState {
  No,
  Yes,
  Unknown,
}

function listMarkerAt(
  source: string,
  lines: BlockLines,
  index: number,
  contentOffset: number,
): ListMarker | undefined {
  if (contentOffset < 0) {
    return;
  }
  const indent = lines.prefixColumns(index) + contentOffset - lines.start(index);
  const marker = source.charCodeAt(contentOffset);
  const lineEnd = lines.end(index);
  let delimiter: number;
  let markerEnd = contentOffset + 1;
  let startNumber = 0;
  if (
    marker === Character.HyphenMinus ||
    marker === Character.PlusSign ||
    marker === Character.Asterisk
  ) {
    const following = source.charCodeAt(markerEnd);
    if (
      (
        markerEnd !== lineEnd &&
        following !== Character.Space &&
        following !== Character.CharacterTabulation
      ) ||
      isThematicBreak(source, lines, index, contentOffset)
    ) {
      return;
    }
    delimiter = marker;
  }
  else {
    if (marker < Character.DigitZero || marker > Character.DigitNine) {
      return;
    }
    let orderedEnd = contentOffset;
    // CommonMark caps ordered markers at nine digits, so the prefix is cheaper to scan than to slice and match.
    while (orderedEnd < lineEnd && orderedEnd - contentOffset < 9) {
      const digit = source.charCodeAt(orderedEnd) - Character.DigitZero;
      if (digit < 0 || digit > 9) {
        break;
      }
      startNumber = startNumber * 10 + digit;
      orderedEnd++;
    }
    delimiter = source.charCodeAt(orderedEnd);
    if (delimiter !== Character.FullStop && delimiter !== Character.RightParenthesis) {
      return;
    }
    if (orderedEnd + 1 < lineEnd) {
      const code = source.charCodeAt(orderedEnd + 1);
      if (code !== Character.Space && code !== Character.CharacterTabulation) {
        return;
      }
    }
    markerEnd = orderedEnd + 1;
  }

  const markerColumn = indent + markerEnd - contentOffset;
  let contentIndent = markerColumn + 1;
  let contentStart = markerEnd;
  let hasContent = false;
  let prefixColumns = 0;
  if (markerEnd < lineEnd) {
    let column = markerColumn;
    while (contentStart < lineEnd) {
      const code = source.charCodeAt(contentStart);
      if (code === Character.Space) {
        column++;
      }
      else if (code === Character.CharacterTabulation) {
        column += 4 - (column % 4);
      }
      else {
        break;
      }
      contentStart++;
    }
    hasContent = contentStart < lineEnd;
    if (hasContent && column - markerColumn <= 4) {
      contentIndent = column;
    }
    else {
      const firstPaddingColumns = source.charCodeAt(markerEnd) === Character.CharacterTabulation
        ? 4 - (markerColumn % 4)
        : 1;
      contentStart = markerEnd + 1;
      prefixColumns = firstPaddingColumns - 1;
    }
  }
  return {
    offset: contentOffset,
    end: markerEnd,
    hasContent,
    contentOffset: contentStart,
    contentIndent,
    contentPrefixColumns: prefixColumns,
    delimiter,
    startNumber,
  };
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
  const tokenEnd = firstChunk - 1 + tokens.nodeLength(firstChunk - 1);
  for (let token = firstChunk; token < tokenEnd; token++) {
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

const buildListItem: BlockNodeBuilder<ListItem> = (tokenStart, context) => {
  const tokens = context.structure.tokens;
  const markerKind = tokens.kind(tokenStart);
  const close = tokenStart + tokens.nodeLength(tokenStart) - 1;
  const start = context.locator.locationAt(tokens.start(tokenStart));
  const children = buildBlockChildren<ListItem["children"][number]>(tokenStart, context);
  return {
    type: "listItem",
    spread: tokens.kind(close) === BlockKind.ListItemSpreadClose,
    checked: markerKind === BlockKind.CheckedTaskItemOpen
      ? true
      : markerKind === BlockKind.UncheckedTaskItemOpen ? false : null,
    children,
    position: {
      start,
      end: children.length
        ? cloneLocation(children.at(-1)!.position!.end as SourceLocation)
        : context.locator.locationAt(tokens.end(close)),
    },
  };
};

function listStartNumber(
  source: string,
  tokens: BlockTokenStream,
  tokenStart: number,
): number {
  // The ordered marker span is exactly its digits plus one delimiter character.
  const digits = source.slice(tokens.start(tokenStart), tokens.end(tokenStart) - 1);
  return Number(digits);
}

function createBuildList(ordered: boolean): BlockNodeBuilder<List> {
  return (tokenStart, context) => {
    const tokens = context.structure.tokens;
    const close = tokenStart + tokens.nodeLength(tokenStart) - 1;
    const start = context.locator.locationAt(tokens.start(tokenStart));
    const children = buildBlockChildren<ListItem>(tokenStart, context);
    return {
      type: "list",
      ordered,
      start: ordered ? listStartNumber(context.source, tokens, tokenStart) : null,
      spread: tokens.kind(close) === BlockKind.ListSpreadClose,
      children,
      position: {
        start,
        end: cloneLocation(children.at(-1)!.position!.end as SourceLocation),
      },
    };
  };
}

const listStart: BlockStart = (source, lines, tokens, start, contentOffset, context) => {
  let marker = listMarkerAt(source, lines, start, contentOffset);
  if (!marker) {
    return;
  }
  const delimiter = marker.delimiter;
  const ordered = delimiter === Character.FullStop || delimiter === Character.RightParenthesis;
  const listOpen = ordered ? BlockKind.OrderedListOpen : BlockKind.UnorderedListOpen;
  tokens.push(listOpen, marker.offset, marker.end);
  let index = start;
  let listEnd = marker.end;
  let listSpread = false;
  let trailingBlank = false;
  while (marker?.delimiter === delimiter) {
    let sibling: ListMarker | undefined;
    // A trailing blank affects the list only when another sibling follows it.
    listSpread ||= trailingBlank;
    trailingBlank = false;
    tokens.push(BlockKind.ListItemOpen, marker.offset, marker.end);
    const itemLines = context.createLineView(
      lines,
      index,
      marker.contentOffset,
      marker.contentPrefixColumns,
    );
    let hasContent = marker.hasContent;
    // Probe the paragraph leaf only when an underindented line needs lazy continuation.
    let paragraphLeaf = hasContent ? ParagraphLeafState.Unknown : ParagraphLeafState.No;
    index++;
    while (index < lines.length) {
      const line = itemLines.pushAfterColumns(source, lines, index, marker.contentIndent);
      if (line === IndentedLine.Blank) {
        if (!hasContent) {
          trailingBlank = true;
          index++;
          sibling = index < lines.length
            ? listMarkerAt(source, lines, index, lineIndentOffset(source, lines, index))
            : void 0;
          break;
        }
        itemLines.pushFrom(lines, index);
        trailingBlank = true;
        paragraphLeaf = ParagraphLeafState.No;
        index++;
        continue;
      }
      if (line === IndentedLine.Appended) {
        trailingBlank = false;
        hasContent = true;
        paragraphLeaf = ParagraphLeafState.Unknown;
        index++;
        continue;
      }
      // Only underindented content reaches here, so any marker starts a sibling item.
      const contentOffset = lineIndentOffset(source, lines, index);
      const candidate = listMarkerAt(
        source,
        lines,
        index,
        contentOffset,
      );
      if (candidate) {
        sibling = candidate;
        break;
      }
      if (paragraphLeaf === ParagraphLeafState.Unknown) {
        paragraphLeaf = context.endsWithParagraphLeaf(source, itemLines, itemLines.length - 1)
          ? ParagraphLeafState.Yes
          : ParagraphLeafState.No;
      }
      if (
        paragraphLeaf === ParagraphLeafState.No ||
        context.startsInterruptingBlock(source, lines, index, contentOffset)
      ) {
        break;
      }
      itemLines.pushLazy(lines, index);
      index++;
    }
    const itemSpread = context.scanLines(source, itemLines, tokens);
    // Close positions exclude the terminal line ending; outer list scans retain it.
    const itemEnd = itemLines.length ? itemLines.end(itemLines.length - 1) : marker.end;
    // A frame's blank-separation summary is known only when its close is emitted.
    tokens.push(itemSpread ? BlockKind.ListItemSpreadClose : BlockKind.ListItemClose, itemEnd, itemEnd);
    listEnd = itemEnd;
    marker = sibling;
  }
  tokens.push(listSpread ? BlockKind.ListSpreadClose : BlockKind.ListClose, listEnd, listEnd);
  return index;
};

const taskListStart: BlockStart = (source, lines, tokens, start, contentOffset, context) => {
  const listToken = tokens.length;
  const nextLine = listStart(source, lines, tokens, start, contentOffset, context);
  if (nextLine === void 0) {
    return;
  }
  // List node lengths jump over nested frames; task variants refine direct item kinds in place.
  for (let item = listToken + 1; item < tokens.length - 1; item += tokens.nodeLength(item)) {
    let paragraph = item + 1;
    let contentKind = tokens.kind(paragraph);
    // Link definition leaves do not count as the item's first content block.
    while (contentKind === BlockKind.LinkDefinition) {
      paragraph += tokens.nodeLength(paragraph);
      contentKind = tokens.kind(paragraph);
    }
    if (contentKind !== BlockKind.ParagraphOpen) {
      continue;
    }
    const firstChunk = paragraph + 1;
    const marker = taskListMarkerAt(
      source,
      tokens.start(firstChunk),
      tokens.end(firstChunk),
    );
    if (!marker || !hasTaskListContent(source, tokens, firstChunk, marker.contentStart)) {
      continue;
    }
    tokens.setKind(
      item,
      marker.checked ? BlockKind.CheckedTaskItemOpen : BlockKind.UncheckedTaskItemOpen,
    );
    tokens.setStart(firstChunk, marker.contentStart);
  }
  return nextLine;
};

export function feature(taskList = false): SyntaxFeature {
  return {
    block: {
      builds: [
        {
          token: [
            BlockKind.ListItemOpen,
            BlockKind.UncheckedTaskItemOpen,
            BlockKind.CheckedTaskItemOpen,
          ],
          build: buildListItem,
        },
        {
          token: BlockKind.UnorderedListOpen,
          build: createBuildList(false),
        },
        {
          token: BlockKind.OrderedListOpen,
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
          unwrapLazyContinuation(source, lines, index, contentOffset, target) {
            const marker = listMarkerAt(source, lines, index, contentOffset);
            if (!marker) {
              return false;
            }
            target.resetFrom(lines, index, marker.contentOffset, marker.contentPrefixColumns);
            return true;
          },
          interrupt(source, lines, index, contentOffset) {
            const marker = listMarkerAt(source, lines, index, contentOffset);
            return marker?.hasContent === true && (
              marker.startNumber === 1 || (
                marker.delimiter !== Character.FullStop &&
                marker.delimiter !== Character.RightParenthesis
              )
            );
          },
          start: taskList ? taskListStart : listStart,
        },
      ],
    },
  };
}
