import type { List, ListItem } from "mdast";
import { BlockLines, contentAfterColumns, isBlank, lineIndentOffset } from "../../block/lines.ts";
import { BlockKind, BlockRule } from "../../constants/block.ts";
import { Character } from "../../constants/character.ts";
import { type BlockNodeBuilder, buildBlockChildren, buildBlockNode } from "../../fragment/block.ts";
import { lastChildEnd } from "../../fragment/node.ts";
import { isThematicBreak } from "./break.ts";
import type { BlockStart } from "../../block/profile.ts";
import type { BlockTokenStream } from "../../block/tokens.ts";
import type { SyntaxFeature } from "../types.ts";

interface ListMarker {
  kind: "ordered" | "unordered";
  indent: number;
  offset: number;
  end: number;
  contentOffset: number;
  contentIndent: number;
  contentPrefixColumns: number;
  delimiter: string;
  startNumber?: number;
}

const enum ParagraphLeafState {
  No,
  Yes,
  Unknown,
}

function listMarkerPadding(
  source: string,
  lines: BlockLines,
  index: number,
  markerEnd: number,
  markerColumn: number,
): { offset: number; columns: number; prefixColumns: number } {
  const lineEnd = lines.end(index);
  if (markerEnd === lineEnd) {
    return { offset: markerEnd, columns: 1, prefixColumns: 0 };
  }
  let offset = markerEnd;
  let column = markerColumn;
  while (offset < lineEnd) {
    const code = source.charCodeAt(offset);
    if (code === Character.Space) {
      column++;
    }
    else if (code === Character.CharacterTabulation) {
      column += 4 - (column % 4);
    }
    else {
      break;
    }
    offset++;
  }
  const whitespaceColumns = column - markerColumn;
  if (offset < lineEnd && whitespaceColumns <= 4) {
    return { offset, columns: whitespaceColumns, prefixColumns: 0 };
  }
  const firstPaddingColumns = source.charCodeAt(markerEnd) === Character.CharacterTabulation
    ? 4 - (markerColumn % 4)
    : 1;
  return { offset: markerEnd + 1, columns: 1, prefixColumns: firstPaddingColumns - 1 };
}

function listMarkerAt(
  source: string,
  lines: BlockLines,
  index: number,
  contentOffset = lineIndentOffset(source, lines, index),
): ListMarker | undefined {
  if (contentOffset < 0) {
    return;
  }
  const indent = lines.prefixColumns(index) + contentOffset - lines.start(index);
  const marker = source.charCodeAt(contentOffset);
  const markerEnd = contentOffset + 1;
  const lineEnd = lines.end(index);
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
    const padding = listMarkerPadding(source, lines, index, markerEnd, indent + 1);
    return {
      kind: "unordered",
      indent,
      offset: contentOffset,
      end: markerEnd,
      contentOffset: padding.offset,
      contentIndent: indent + 1 + padding.columns,
      contentPrefixColumns: padding.prefixColumns,
      delimiter: String.fromCharCode(marker),
    };
  }
  if (marker < Character.DigitZero || marker > Character.DigitNine) {
    return;
  }
  let startNumber = 0;
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
  const delimiter = source[orderedEnd];
  if (delimiter !== "." && delimiter !== ")") {
    return;
  }
  if (orderedEnd + 1 < lineEnd) {
    const code = source.charCodeAt(orderedEnd + 1);
    if (code !== Character.Space && code !== Character.CharacterTabulation) {
      return;
    }
  }
  orderedEnd++;
  const markerWidth = orderedEnd - contentOffset;
  const padding = listMarkerPadding(source, lines, index, orderedEnd, indent + markerWidth);
  return {
    kind: "ordered",
    indent,
    offset: contentOffset,
    end: orderedEnd,
    contentOffset: padding.offset,
    contentIndent: indent + markerWidth + padding.columns,
    contentPrefixColumns: padding.prefixColumns,
    delimiter,
    startNumber,
  };
}

function sameList(a: ListMarker, b: ListMarker): boolean {
  return a.kind === b.kind && a.delimiter === b.delimiter;
}

function hasListContent(
  source: string,
  lines: BlockLines,
  index: number,
  marker: ListMarker | undefined,
): boolean {
  return !!marker && /\S/.test(source.slice(marker.contentOffset, lines.end(index)));
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

const buildListItem: BlockNodeBuilder<ListItem> = (tokenStart, context) => {
  const tokens = context.structure.tokens;
  const markerKind = tokens.kind(tokenStart);
  const start = context.locator.locationAt(tokens.start(tokenStart));
  const children = buildBlockChildren(tokenStart, context);
  const close = tokenStart + tokens.nodeLength(tokenStart) - 1;
  return {
    type: "listItem",
    spread: tokens.value<boolean>(close) === true,
    checked: markerKind === BlockKind.CheckedTaskItemOpen
      ? true
      : markerKind === BlockKind.UncheckedTaskItemOpen ? false : null,
    children,
    position: {
      start,
      end: lastChildEnd(children) ?? context.locator.locationAt(tokens.contentEnd(close)),
    },
  };
};

function createBuildList(ordered: boolean): BlockNodeBuilder<List> {
  return (tokenStart, context) => {
    const tokens = context.structure.tokens;
    const start = context.locator.locationAt(tokens.start(tokenStart));
    const items: ListItem[] = [];
    const close = tokenStart + tokens.nodeLength(tokenStart) - 1;
    // Indexed list roots contain only direct item frames, so node lengths jump between siblings.
    for (let child = tokenStart + 1; child < close; child += tokens.nodeLength(child)) {
      items.push(buildBlockNode(child, context));
    }
    return {
      type: "list",
      ordered,
      start: ordered ? tokens.value<number>(tokenStart)! : null,
      spread: tokens.value<boolean>(close) === true,
      children: items,
      position: {
        start,
        end: lastChildEnd(items) ?? context.locator.locationAt(tokens.end(tokenStart)),
      },
    };
  };
}

const listStart: BlockStart = (source, lines, start, contentOffset, out, context) => {
  let marker = listMarkerAt(source, lines, start, contentOffset);
  if (!marker) {
    return;
  }
  const listMarker = marker;
  const kind = listMarker.kind;
  const listOpen = kind === "ordered" ? BlockKind.OrderedListOpen : BlockKind.UnorderedListOpen;
  const listClose = kind === "ordered" ? BlockKind.OrderedListClose : BlockKind.UnorderedListClose;
  out.push(
    listOpen,
    listMarker.offset,
    listMarker.end,
    kind === "ordered" ? { value: listMarker.startNumber } : void 0,
  );
  let index = start;
  let listEnd = listMarker.end;
  let listSpread = false;
  let trailingBlank = false;
  while (marker && sameList(marker, listMarker)) {
    let sibling: ListMarker | undefined;
    // A trailing blank affects the list only when another sibling follows it.
    listSpread ||= trailingBlank;
    trailingBlank = false;
    out.push(BlockKind.ListItemOpen, marker.offset, marker.end);
    const itemLines = new BlockLines();
    itemLines.pushFrom(lines, index, marker.contentOffset, marker.contentPrefixColumns);
    let hasContent = !isBlank(source, itemLines, 0);
    // Probe the paragraph leaf only when an underindented line needs lazy continuation.
    let paragraphLeaf = hasContent ? ParagraphLeafState.Unknown : ParagraphLeafState.No;
    index++;
    while (index < lines.length) {
      const candidate = listMarkerAt(source, lines, index);
      if (candidate && candidate.indent < marker.contentIndent) {
        sibling = candidate;
        break;
      }
      if (isBlank(source, lines, index)) {
        if (!hasContent) {
          trailingBlank = true;
          index++;
          sibling = index < lines.length ? listMarkerAt(source, lines, index) : void 0;
          break;
        }
        itemLines.pushFrom(lines, index);
        trailingBlank = true;
        paragraphLeaf = ParagraphLeafState.No;
        index++;
        continue;
      }
      const content = contentAfterColumns(source, lines, index, marker.contentIndent);
      if (content) {
        itemLines.pushFrom(lines, index, content.offset, content.prefixColumns);
        trailingBlank = false;
        hasContent = true;
        paragraphLeaf = ParagraphLeafState.Unknown;
        index++;
        continue;
      }
      if (paragraphLeaf === ParagraphLeafState.Unknown) {
        paragraphLeaf = context.endsWithParagraphLeaf(source, itemLines, itemLines.length - 1)
          ? ParagraphLeafState.Yes
          : ParagraphLeafState.No;
      }
      if (
        paragraphLeaf === ParagraphLeafState.No ||
        context.startsInterruptingBlock(source, lines, index)
      ) {
        break;
      }
      itemLines.pushLazy(lines, index);
      index++;
    }
    const itemSpread = context.scanLines(source, itemLines, out);
    listEnd = itemLines.next(itemLines.length - 1);
    // A frame's blank-separation summary is known only when its close is emitted.
    out.push(
      BlockKind.ListItemClose,
      listEnd,
      listEnd,
      itemSpread ? { value: true } : void 0,
    );
    marker = sibling;
  }
  out.push(listClose, listEnd, listEnd, listSpread ? { value: true } : void 0);
  return index;
};

const taskListStart: BlockStart = (source, lines, start, contentOffset, out, context) => {
  const listTokenStart = out.length;
  const nextLine = listStart(source, lines, start, contentOffset, out, context);
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
          build: buildListItem,
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
            return hasListContent(source, lines, index, marker) && (
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
