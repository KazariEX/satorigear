import type { List, ListItem } from "mdast";
import { BlockKind } from "../../block/kinds.ts";
import {
  type BlockLine,
  contentAfterColumns,
  indentOf,
  isBlank,
  lineIndent,
} from "../../block/lines.ts";
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
  stripBlockQuotes: boolean,
  context: BlockBuildContext,
  nestedRule?: string,
): boolean {
  const arena = context.arena;
  let previous: { end: number; start: number } | undefined;
  const childCount = arena.childCount(nodeId);
  for (let index = 0; index < childCount; index++) {
    const childId = arena.childAt(nodeId, index);
    if (
      childId < 0 ||
      (nestedRule === void 0
        ? !arena.isBlock(childId)
        : arena.ruleNameOf(childId) !== nestedRule)
    ) {
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

const buildListItem: BlockNodeBuilder<ListItem> = (nodeId, offset, tokenBase, context) => {
  const rule = context.arena.ruleNameOf(nodeId);
  if (rule !== "OrderedListItem" && rule !== "UnorderedListItem") {
    throw new Error(`Expected list item syntax, received ${rule}`);
  }
  const marker = blockToken(
    nodeId,
    tokenBase,
    rule === "OrderedListItem" ? BlockKind.OrderedItemOpen : BlockKind.UnorderedItemOpen,
    context,
  );
  const children = buildBlockChildren(nodeId, offset, tokenBase, context);
  return {
    type: "listItem",
    spread: childrenSpread(nodeId, offset, tokenBase, true, context),
    checked: null,
    children,
    position: {
      start: context.arena.tokens.start(marker),
      end: lastChildEnd(children, blockEnd(nodeId, offset, context)),
    },
  };
};

function createBuildList(ordered: boolean): BlockNodeBuilder<List> {
  return (nodeId, offset, tokenBase, context) => {
    const arena = context.arena;
    const itemRule = ordered ? "OrderedListItem" : "UnorderedListItem";
    const listMarker = blockToken(
      nodeId,
      tokenBase,
      ordered ? BlockKind.OrderedListOpen : BlockKind.UnorderedListOpen,
      context,
    );
    const items: SpannedNode<ListItem>[] = [];
    const childCount = arena.childCount(nodeId);
    for (let index = 0; index < childCount; index++) {
      const childId = arena.childAt(nodeId, index);
      if (childId >= 0 && arena.ruleNameOf(childId) === itemRule) {
        items.push(buildListItem(
          childId,
          offset + arena.childRelAt(nodeId, index),
          tokenBase + arena.childTokRelAt(nodeId, index),
          context,
        ));
      }
    }
    return {
      type: "list",
      ordered,
      start: ordered ? Number.parseInt(context.arena.tokens.text(context.source, listMarker), 10) : null,
      spread: childrenSpread(nodeId, offset, tokenBase, false, context, itemRule),
      children: items,
      position: {
        start: context.arena.tokens.start(listMarker),
        end: lastChildEnd(items, context.arena.tokens.end(listMarker)),
      },
    };
  };
}

export const feature: SyntaxFeature = {
  block: {
    rules: [
      {
        rule: "UnorderedListItem",
        syntax: {
          kind: "frame",
          open: BlockKind.UnorderedItemOpen,
          close: BlockKind.UnorderedItemClose,
        },
      },
      {
        rule: "OrderedListItem",
        syntax: {
          kind: "frame",
          open: BlockKind.OrderedItemOpen,
          close: BlockKind.OrderedItemClose,
        },
      },
      {
        rule: "UnorderedList",
        syntax: {
          kind: "block",
          open: BlockKind.UnorderedListOpen,
          close: BlockKind.UnorderedListClose,
        },
        build: createBuildList(false),
      },
      {
        rule: "OrderedList",
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
          const listOpen = kind === "ordered" ? BlockKind.OrderedListOpen : BlockKind.UnorderedListOpen;
          const listClose = kind === "ordered" ? BlockKind.OrderedListClose : BlockKind.UnorderedListClose;
          const itemOpen = kind === "ordered" ? BlockKind.OrderedItemOpen : BlockKind.UnorderedItemOpen;
          const itemClose = kind === "ordered" ? BlockKind.OrderedItemClose : BlockKind.UnorderedItemClose;
          out.push(listOpen, listMarker.offset, listMarker.offset + listMarker.text.length);
          let index = start;
          let listEnd = listMarker.offset + listMarker.text.length;
          while (index < lines.length) {
            const marker = listMarkerAt(source, lines[index]);
            if (!marker || !sameList(marker, listMarker)) {
              break;
            }
            out.push(itemOpen, marker.offset, marker.offset + marker.text.length);
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
            out.push(itemClose, listEnd, listEnd);
          }
          out.push(listClose, listEnd, listEnd);
          return index;
        },
      },
    ],
  },
};
