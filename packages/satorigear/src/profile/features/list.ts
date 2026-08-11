import type { List, ListItem } from "mdast";
import {
  type BlockLine,
  contentAfterColumns,
  indentOf,
  isBlank,
  lineIndent,
} from "../../block/lines.ts";
import { structuralToken, tokenEnd, tokenStart } from "../../block/tokens.ts";
import {
  blockChildren,
  blockEnd,
  type BlockProjectionContext,
  type BlockProjector,
  blockToken,
  lastChildEnd,
  payloadBounds,
  withSpan,
} from "../../mdast.ts";
import { isThematicBreak } from "./break.ts";
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
  if (markerCode < 48 || markerCode > 57) {
    return;
  }
  let startNumber = 0;
  let orderedEnd = indent.offset;
  // CommonMark caps ordered markers at nine digits, so the prefix is cheaper to scan than to slice and match.
  while (orderedEnd < line.end && orderedEnd - indent.offset < 9) {
    const digit = source.charCodeAt(orderedEnd) - 48;
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
  const result: ListItem = {
    type: "listItem",
    spread: childrenSpread(nodeId, offset, tokenBase, "Block", true, context),
    checked: null,
    children: blockChildren(nodeId, offset, tokenBase, context),
  };
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
    const result: List = {
      type: "list",
      ordered,
      start: ordered ? Number.parseInt(listMarker.text, 10) : null,
      spread: childrenSpread(nodeId, offset, tokenBase, itemRule, false, context),
      children: items,
    };
    return withSpan(result, tokenStart(listMarker), lastChildEnd(result, tokenEnd(listMarker)));
  };
}

export const feature: SyntaxFeature = {
  block: {
    rules: [
      {
        rule: "UnorderedListItem",
        syntax: {
          kind: "frame",
          open: "UnorderedItemOpen",
          close: "UnorderedItemClose",
          wrapsBlock: false,
        },
      },
      {
        rule: "OrderedListItem",
        syntax: {
          kind: "frame",
          open: "OrderedItemOpen",
          close: "OrderedItemClose",
          wrapsBlock: false,
        },
      },
      {
        rule: "UnorderedList",
        syntax: {
          kind: "frame",
          open: "UnorderedListOpen",
          close: "UnorderedListClose",
          wrapsBlock: true,
        },
        project: projectList(false),
      },
      {
        rule: "OrderedList",
        syntax: {
          kind: "frame",
          open: "OrderedListOpen",
          close: "OrderedListClose",
          wrapsBlock: true,
        },
        project: projectList(true),
      },
    ],
    starts: [
      {
        codes: [42, 43, 45, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57],
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
        start(source, lines, start, out, contentOffset, context) {
          const listMarker = listMarkerAt(source, lines[start]);
          if (!listMarker) {
            return;
          }
          const kind = listMarker.kind;
          const listOpen = kind === "ordered" ? "OrderedListOpen" : "UnorderedListOpen";
          const listClose = kind === "ordered" ? "OrderedListClose" : "UnorderedListClose";
          const itemOpen = kind === "ordered" ? "OrderedItemOpen" : "UnorderedItemOpen";
          const itemClose = kind === "ordered" ? "OrderedItemClose" : "UnorderedItemClose";
          out.push(structuralToken(listOpen, listMarker.offset, listMarker.text));
          let index = start;
          let listEnd = listMarker.offset + listMarker.text.length;
          while (index < lines.length) {
            const marker = listMarkerAt(source, lines[index]);
            if (!marker || !sameList(marker, listMarker)) {
              break;
            }
            out.push(structuralToken(itemOpen, marker.offset, marker.text));
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
            context.resolveLines(source, itemLines, out);
            listEnd = itemLines.at(-1)?.next ?? marker.offset;
            out.push(structuralToken(itemClose, listEnd));
          }
          out.push(structuralToken(listClose, listEnd));
          return index;
        },
      },
    ],
  },
};
