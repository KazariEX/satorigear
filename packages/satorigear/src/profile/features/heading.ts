import type { Heading } from "mdast";
import { BlockKind, BlockRule } from "../../constants/block.ts";
import { Character } from "../../constants/character.ts";
import { blockEnd } from "../../fragment/block.ts";
import { firstChildStart } from "../../fragment/node.ts";
import type { BlockLines } from "../../block/lines.ts";
import type { SyntaxFeature } from "../types.ts";

function atxAt(
  source: string,
  lines: BlockLines,
  index: number,
  markerOffset: number,
): {
  contentEnd: number;
  contentOffset: number;
  markerEnd: number;
} | undefined {
  let markerEnd = markerOffset + 1;
  const lineEnd = lines.end(index);
  while (markerEnd < lineEnd && markerEnd - markerOffset < 6 && source[markerEnd] === "#") {
    markerEnd++;
  }
  if (markerEnd < lineEnd && source[markerEnd] !== " " && source[markerEnd] !== "\t") {
    return;
  }
  let contentOffset = markerEnd;
  while (contentOffset < lineEnd && (source[contentOffset] === " " || source[contentOffset] === "\t")) {
    contentOffset++;
  }
  let contentEnd = lineEnd;
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
    markerEnd,
    contentOffset,
    contentEnd,
  };
}

export function setextMarkerAt(
  source: string,
  lines: BlockLines,
  index: number,
  markerOffset: number,
): "=" | "-" | undefined {
  if (markerOffset < 0) {
    return;
  }
  const marker = source[markerOffset];
  if (marker !== "=" && marker !== "-") {
    return;
  }
  const lineEnd = lines.end(index);
  let offset = markerOffset + 1;
  while (offset < lineEnd && source[offset] === marker) {
    offset++;
  }
  while (offset < lineEnd && (source[offset] === " " || source[offset] === "\t")) {
    offset++;
  }
  return offset === lineEnd ? marker : void 0;
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
        interrupt(source, lines, index, contentOffset) {
          return !!atxAt(source, lines, index, contentOffset);
        },
        start(source, lines, start, contentOffset, out) {
          const atx = atxAt(source, lines, start, contentOffset);
          if (!atx) {
            return;
          }
          out.push(BlockKind.AtxHeadingOpen, contentOffset, atx.markerEnd);
          if (atx.contentEnd > atx.contentOffset) {
            out.push(BlockKind.InlineChunk, atx.contentOffset, atx.contentEnd);
          }
          const lineEnd = lines.end(start);
          out.push(BlockKind.HeadingClose, lineEnd, lineEnd);
          return start + 1;
        },
      },
    ],
  },
};
