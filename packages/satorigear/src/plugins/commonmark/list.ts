import type { List, ListItem } from "mdast";
import {
  indentOf,
  isBlank,
  lineIndent,
  structural,
} from "../../block/scanner.ts";
import {
  blockChildren,
  blockEnd,
  type BlockProjectionContext,
  type BlockProjector,
  blockToken,
  lastChildEnd,
  normalizeLines,
  payloadBounds,
  tokenEnd,
  tokenStart,
  withSpan,
} from "../../mdast.ts";
import { isThematicBreak } from "./break.ts";
import type { BlockLine, BlockStart } from "../profile.ts";

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

function listMarkerAt(source: string, line: BlockLine): ListMarker | null {
  const indent = lineIndent(source, line);
  if (!indent) {
    return null;
  }
  const marker = source[indent.offset];
  const markerEnd = indent.offset + 1;
  if ((marker === "-" || marker === "+" || marker === "*")
    && (markerEnd === line.end || source[markerEnd] === " " || source[markerEnd] === "\t")
    && !isThematicBreak(source, line, indent.offset)) {
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
  if (!(markerCode >= 48 && markerCode <= 57)) {
    return null;
  }
  const body = source.slice(indent.offset, line.end);
  const ordered = /^(\d{1,9})([.)])(?=[ \t]|$)/.exec(body);
  if (!ordered) {
    return null;
  }
  const orderedEnd = indent.offset + ordered[0].length;
  const markerWidth = ordered[0].length;
  const padding = listMarkerPadding(source, line, orderedEnd, indent.columns + markerWidth);
  return {
    kind: "ordered",
    indent: indent.columns,
    offset: indent.offset,
    contentOffset: padding.offset,
    contentIndent: indent.columns + markerWidth + padding.columns,
    contentPrefixColumns: padding.prefixColumns,
    delimiter: ordered[2],
    text: ordered[1] + ordered[2],
    startNumber: Number(ordered[1]),
  };
}

function sameList(a: ListMarker, b: ListMarker): boolean {
  return a.kind === b.kind && a.delimiter === b.delimiter;
}

function contentAfterColumns(
  source: string,
  line: BlockLine,
  columns: number,
): { offset: number; prefixColumns: number } {
  let offset = line.start;
  let consumed = line.prefixColumns ?? 0;
  if (consumed >= columns) {
    return { offset, prefixColumns: consumed - columns };
  }
  while (offset < line.end && consumed < columns) {
    if (source[offset] === " ") {
      consumed++;
      offset++;
      continue;
    }
    if (source[offset] === "\t") {
      consumed += 4 - (consumed % 4);
      offset++;
      continue;
    }
    break;
  }
  return { offset, prefixColumns: Math.max(0, consumed - columns) };
}

function hasListContent(source: string, line: BlockLine, marker: ListMarker | null): boolean {
  return !!marker && /\S/.test(source.slice(marker.contentOffset, line.end));
}

export function unwrapListItem(source: string, line: BlockLine): BlockLine | undefined {
  const marker = listMarkerAt(source, line);
  return marker ? { ...line, start: marker.contentOffset, prefixColumns: marker.contentPrefixColumns } : void 0;
}

export function listInterrupt(source: string, line: BlockLine): boolean {
  const marker = listMarkerAt(source, line);
  return hasListContent(source, line, marker)
    && (marker?.kind === "unordered" || (marker?.kind === "ordered" && marker.startNumber === 1));
}

export const listStart: BlockStart = (source, lines, start, out, _contentOffset, context) => {
  const listMarker = listMarkerAt(source, lines[start]);
  if (!listMarker) {
    return void 0;
  }
  const kind = listMarker.kind;
  const listOpen = kind === "ordered" ? "OrderedListOpen" : "UnorderedListOpen";
  const listClose = kind === "ordered" ? "OrderedListClose" : "UnorderedListClose";
  const itemOpen = kind === "ordered" ? "OrderedItemOpen" : "UnorderedItemOpen";
  const itemClose = kind === "ordered" ? "OrderedItemClose" : "UnorderedItemClose";
  out.push(structural(listOpen, listMarker.offset, listMarker.text));
  let index = start;
  let listEnd = listMarker.offset + listMarker.text.length;
  while (index < lines.length) {
    const marker = listMarkerAt(source, lines[index]);
    if (!marker || !sameList(marker, listMarker)) {
      break;
    }
    out.push(structural(itemOpen, marker.offset, marker.text));
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
      if (!lazyParagraph || context.interruptsParagraph(source, lines[index])) {
        break;
      }
      itemLines.push({ ...lines[index], lazy: true });
      index++;
    }
    context.resolveLines(source, itemLines, out);
    listEnd = itemLines.at(-1)?.next ?? marker.offset;
    out.push(structural(itemClose, listEnd));
  }
  out.push(structural(listClose, listEnd));
  return index;
};

function hasBlankLineBetween(source: string, start: number, end: number, stripBlockQuotes: boolean): boolean {
  const lines = normalizeLines(source.slice(Math.max(0, start - 1), end)).split("\n");
  return lines.slice(1, -1).some((line) => {
    if (stripBlockQuotes) {
      while (/^ {0,3}>/.test(line)) {
        line = line.replace(/^ {0,3}>[ \t]?/, "");
      }
    }
    return /^[ \t]*$/.test(line);
  });
}

function childrenSpread(
  nodeId: number,
  offset: number,
  tokenBase: number,
  childRule: string,
  stripBlockQuotes: boolean,
  context: BlockProjectionContext,
): boolean {
  const arena = context.view.arena;
  let previous: { end: number; start: number } | undefined;
  const childCount = arena.childCount(nodeId);
  for (let index = 0; index < childCount; index++) {
    const childId = arena.childAt(nodeId, index);
    if (childId < 0 || arena.ruleNameOf(childId) !== childRule) {
      continue;
    }
    const childOffset = offset + arena.childRelAt(nodeId, index);
    const childTokenBase = tokenBase + arena.childTokRelAt(nodeId, index);
    const current = payloadBounds(childId, childOffset, childTokenBase, context);
    if (previous && hasBlankLineBetween(context.source, previous.end, current.start, stripBlockQuotes)) {
      return true;
    }
    previous = current;
  }
  return false;
}

function listItem(
  nodeId: number,
  offset: number,
  tokenBase: number,
  context: BlockProjectionContext,
): ListItem {
  const rule = context.view.arena.ruleNameOf(nodeId);
  if (rule !== "OrderedListItem" && rule !== "UnorderedListItem") {
    throw new Error(`Expected list item syntax, received ${rule}`);
  }
  const marker = blockToken(
    nodeId,
    tokenBase,
    rule === "OrderedListItem" ? "OrderedItemOpen" : "UnorderedItemOpen",
    context,
  );
  const result = {
    type: "listItem",
    spread: childrenSpread(nodeId, offset, tokenBase, "Block", true, context),
    checked: null,
    children: blockChildren(nodeId, offset, tokenBase, context),
  } satisfies ListItem;
  return withSpan(result, tokenStart(marker), lastChildEnd(result, blockEnd(nodeId, offset, context)));
}

function projectList(ordered: boolean): BlockProjector {
  return (nodeId, offset, tokenBase, context) => {
    const arena = context.view.arena;
    const itemRule = ordered ? "OrderedListItem" : "UnorderedListItem";
    const listMarker = blockToken(nodeId, tokenBase, ordered ? "OrderedListOpen" : "UnorderedListOpen", context);
    const items: ListItem[] = [];
    const childCount = arena.childCount(nodeId);
    for (let index = 0; index < childCount; index++) {
      const childId = arena.childAt(nodeId, index);
      if (childId >= 0 && arena.ruleNameOf(childId) === itemRule) {
        items.push(listItem(
          childId,
          offset + arena.childRelAt(nodeId, index),
          tokenBase + arena.childTokRelAt(nodeId, index),
          context,
        ));
      }
    }
    const result = {
      type: "list",
      ordered,
      start: ordered ? Number.parseInt(listMarker.text, 10) : null,
      spread: childrenSpread(nodeId, offset, tokenBase, itemRule, false, context),
      children: items,
    } satisfies List;
    return withSpan(result, tokenStart(listMarker), lastChildEnd(result, tokenEnd(listMarker)));
  };
}

export const projectUnorderedList = projectList(false);
export const projectOrderedList = projectList(true);
