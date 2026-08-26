import type { Heading } from "mdast";
import { type BlockLine, lineIndentOffset } from "../../block/lines.ts";
import { BlockKind, BlockRule } from "../../constants/block.ts";
import { Character } from "../../constants/character.ts";
import { blockEnd } from "../../fragment/block.ts";
import { firstChildStart } from "../../fragment/node.ts";
import type { SyntaxFeature } from "../types.ts";

function atxAt(source: string, line: BlockLine): {
  contentEnd: number;
  contentOffset: number;
  marker: string;
  markerOffset: number;
} | undefined {
  const markerOffset = lineIndentOffset(source, line);
  if (markerOffset < 0 || source[markerOffset] !== "#") {
    return;
  }
  let markerEnd = markerOffset + 1;
  while (markerEnd < line.end && markerEnd - markerOffset < 6 && source[markerEnd] === "#") {
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
    markerOffset,
    marker: source.slice(markerOffset, markerEnd),
    contentOffset,
    contentEnd,
  };
}

export function setextMarkerAt(source: string, line: BlockLine): "=" | "-" | undefined {
  const markerOffset = lineIndentOffset(source, line);
  if (markerOffset < 0) {
    return;
  }
  const marker = source[markerOffset];
  const match = marker === "=" || marker === "-"
    ? /^(=+|-+)[ \t]*$/.exec(source.slice(markerOffset, line.end))
    : void 0;
  return match ? match[1][0] as "=" | "-" : void 0;
}

export const feature: SyntaxFeature = {
  block: {
    rules: [
      {
        rule: BlockRule.AtxHeading,
        syntax: {
          kind: "block",
          open: BlockKind.AtxHeadingOpen,
          close: BlockKind.HeadingClose,
        },
        inlineContent: true,
        build(tokenStart, context, inline) {
          const tokens = context.structure.tokens;
          return {
            type: "heading",
            depth: tokens.end(tokenStart) - tokens.start(tokenStart) as Heading["depth"],
            children: inline!.children,
            position: {
              start: tokens.start(tokenStart),
              end: blockEnd(tokenStart, context),
            },
          };
        },
      },
      {
        rule: BlockRule.SetextHeading,
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
          const tokens = context.structure.tokens;
          const children = inline!.children;
          return {
            type: "heading",
            depth: tokens.kind(tokenStart) === BlockKind.SetextHeading1Open ? 1 : 2,
            children,
            position: {
              start: firstChildStart(children),
              end: tokens.start(tokenStart + tokens.nodeLength(tokenStart) - 1),
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
