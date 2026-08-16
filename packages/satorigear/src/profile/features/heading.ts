import type { Heading } from "mdast";
import { BlockKind } from "../../block/kinds.ts";
import { type BlockLine, lineIndent } from "../../block/lines.ts";
import { Character } from "../../constants/character.ts";
import {
  blockEnd,
  blockToken,
  directBlockToken,
} from "../../fragment/block.ts";
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
        build(tokenStart, context, inline) {
          const marker = blockToken(tokenStart, BlockKind.AtxHeadingOpen, context);
          return {
            type: "heading",
            depth: context.structure.tokens.end(marker) - context.structure.tokens.start(marker) as Heading["depth"],
            children: inline!.children,
            position: {
              start: context.structure.tokens.start(marker),
              end: blockEnd(tokenStart, context),
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
        build(tokenStart, context, inline) {
          const levelOne = directBlockToken(tokenStart, BlockKind.SetextHeading1Open, context);
          if (levelOne === void 0) {
            blockToken(tokenStart, BlockKind.SetextHeading2Open, context);
          }
          const children = inline!.children;
          return {
            type: "heading",
            depth: levelOne === void 0 ? 2 : 1,
            children,
            position: {
              start: firstChildStart(children),
              end: context.structure.tokens.start(
                blockToken(tokenStart, BlockKind.HeadingClose, context),
              ),
            },
          };
        },
      },
    ],
    starts: [
      {
        codes: [
          Character.NumberSign,
        ],
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
