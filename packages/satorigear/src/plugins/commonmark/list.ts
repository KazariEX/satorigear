import type { List, ListItem } from "mdast";
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
