import type { Heading } from "mdast";
import { BlockKind } from "../../block/kinds.ts";
import { type BlockLine, lineIndent } from "../../block/lines.ts";
import {
  blockEnd,
  blockToken,
  directBlockToken,
} from "../../fragment/block.ts";
import { buildInlineChildren } from "../../fragment/inline.ts";
import { firstChildStart } from "../../fragment/node.ts";
import type { SyntaxFeature } from "../types.ts";

function atxAt(source: string, line: BlockLine): {
  contentEnd: number;
  contentOffset: number;
  marker: string;
  markerOffset: number;
} | undefined {
  const indent = lineIndent(source, line);
  if (!indent || source[indent.offset] !== "#") {
    return;
  }
  let markerEnd = indent.offset + 1;
  while (markerEnd < line.end && markerEnd - indent.offset < 6 && source[markerEnd] === "#") {
    markerEnd++;
  }
  if (markerEnd < line.end && source[markerEnd] !== " " && source[markerEnd] !== "\t") {
    return;
  }
  let contentOffset = markerEnd;
  while (contentOffset < line.end && (source[contentOffset] === " " || source[contentOffset] === "\t")) {
    contentOffset++;
  }
  let contentEnd = line.end;
  while (contentEnd > contentOffset && (source[contentEnd - 1] === " " || source[contentEnd - 1] === "\t")) {
    contentEnd--;
  }
  let closer = contentEnd;
  while (closer > contentOffset && source[closer - 1] === "#") {
    closer--;
  }
  if (closer < contentEnd && (closer === contentOffset || source[closer - 1] === " " || source[closer - 1] === "\t")) {
    contentEnd = closer;
    while (contentEnd > contentOffset && (source[contentEnd - 1] === " " || source[contentEnd - 1] === "\t")) {
      contentEnd--;
    }
  }
  return {
    markerOffset: indent.offset,
    marker: source.slice(indent.offset, markerEnd),
    contentOffset,
    contentEnd,
  };
}

export function setextMarkerAt(source: string, line: BlockLine): "=" | "-" | undefined {
  const indent = lineIndent(source, line);
  if (!indent) {
    return;
  }
  const marker = source[indent.offset];
  const match = marker === "=" || marker === "-"
    ? /^(=+|-+)[ \t]*$/.exec(source.slice(indent.offset, line.end))
    : void 0;
  return match ? match[1][0] as "=" | "-" : void 0;
}

export const feature: SyntaxFeature = {
  block: {
    rules: [
      {
        rule: "AtxHeading",
        syntax: {
          kind: "block",
          open: BlockKind.AtxHeadingOpen,
          close: BlockKind.HeadingClose,
        },
        inlineContent: true,
        build(nodeId, offset, tokenBase, context) {
          const marker = blockToken(nodeId, tokenBase, BlockKind.AtxHeadingOpen, context);
          return {
            type: "heading",
            depth: context.view.tokens.end(marker) - context.view.tokens.start(marker) as Heading["depth"],
            children: buildInlineChildren(nodeId, context, true),
            position: {
              start: context.view.tokens.start(marker),
              end: blockEnd(nodeId, offset, context),
            },
          };
        },
      },
      {
        rule: "SetextHeading",
        syntax: {
          kind: "block",
          open: [
            BlockKind.SetextHeading1Open,
            BlockKind.SetextHeading2Open,
          ],
          close: BlockKind.HeadingClose,
        },
        inlineContent: true,
        build(nodeId, offset, tokenBase, context) {
          const levelOne = directBlockToken(nodeId, tokenBase, BlockKind.SetextHeading1Open, context);
          if (levelOne === void 0) {
            blockToken(nodeId, tokenBase, BlockKind.SetextHeading2Open, context);
          }
          const children = buildInlineChildren(nodeId, context);
          return {
            type: "heading",
            depth: levelOne === void 0 ? 2 : 1,
            children,
            position: {
              start: firstChildStart(children),
              end: context.view.tokens.start(
                blockToken(nodeId, tokenBase, BlockKind.HeadingClose, context),
              ),
            },
          };
        },
      },
    ],
    starts: [
      {
        codes: [35],
        interrupt(source, line) {
          return !!atxAt(source, line);
        },
        start(source, lines, start, out) {
          const line = lines[start];
          const atx = atxAt(source, line);
          if (!atx) {
            return;
          }
          out.push(BlockKind.AtxHeadingOpen, atx.markerOffset, atx.markerOffset + atx.marker.length);
          if (atx.contentEnd > atx.contentOffset) {
            out.push(BlockKind.InlineChunk, atx.contentOffset, atx.contentEnd);
          }
          out.push(BlockKind.HeadingClose, line.end, line.end);
          return start + 1;
        },
      },
    ],
  },
};
