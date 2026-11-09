import type { Heading } from "mdast";
import { type BlockLines, trimLineWhitespaceEnd, trimLineWhitespaceStart } from "../../block/lines.ts";
import { BlockKind } from "../../constants/block.ts";
import { Character } from "../../constants/character.ts";
import { buildInlineFragment } from "../../fragment/inline.ts";
import { firstChildStart } from "../../fragment/node.ts";
import type { SyntaxFeature } from "../types.ts";

function atxAt(
  source: string,
  lines: BlockLines,
  index: number,
  markerOffset: number,
): {
  contentEnd: number;
  contentOffset: number;
  depth: Heading["depth"];
} | undefined {
  let markerEnd = markerOffset + 1;
  const lineEnd = lines.end(index);
  while (markerEnd < lineEnd && markerEnd - markerOffset < 6 && source[markerEnd] === "#") {
    markerEnd++;
  }
  if (markerEnd < lineEnd && source[markerEnd] !== " " && source[markerEnd] !== "\t") {
    return;
  }
  const contentOffset = trimLineWhitespaceStart(source, markerEnd, lineEnd);
  let contentEnd = trimLineWhitespaceEnd(source, contentOffset, lineEnd);
  let closer = contentEnd;
  while (closer > contentOffset && source[closer - 1] === "#") {
    closer--;
  }
  if (
    closer < contentEnd && (
      closer === contentOffset || source[closer - 1] === " " || source[closer - 1] === "\t"
    )
  ) {
    contentEnd = trimLineWhitespaceEnd(source, contentOffset, closer);
  }
  return {
    contentOffset,
    contentEnd,
    depth: markerEnd - markerOffset as Heading["depth"],
  };
}

export function setextMarkerAt(
  source: string,
  lines: BlockLines,
  index: number,
  markerOffset: number,
): "=" | "-" | undefined {
  const marker = source[markerOffset];
  if (marker !== "=" && marker !== "-") {
    return;
  }
  const lineEnd = lines.end(index);
  let offset = markerOffset + 1;
  while (offset < lineEnd && source[offset] === marker) {
    offset++;
  }
  offset = trimLineWhitespaceStart(source, offset, lineEnd);
  return offset === lineEnd ? marker : void 0;
}

export const feature: SyntaxFeature = {
  block: {
    builds: [
      {
        token: [
          BlockKind.AtxHeading1Open,
          BlockKind.AtxHeading2Open,
          BlockKind.AtxHeading3Open,
          BlockKind.AtxHeading4Open,
          BlockKind.AtxHeading5Open,
          BlockKind.AtxHeading6Open,
        ],
        build(tokenStart, context) {
          const tokens = context.structure.tokens;
          const kind = tokens.kind(tokenStart);
          const inline = buildInlineFragment(tokenStart, false, context);
          const children = inline.children;
          const result: Heading = {
            type: "heading",
            depth: kind - BlockKind.AtxHeading1Open + 1 as Heading["depth"],
            children,
            position: {
              start: context.locator.locationAt(tokens.start(tokenStart)),
              end: context.locator.locationAt(tokens.end(tokenStart)),
            },
          };
          if (inline.attributes) {
            result.attributes = inline.attributes;
          }
          return result;
        },
      },
      {
        token: [
          BlockKind.SetextHeading1Open,
          BlockKind.SetextHeading2Open,
        ],
        build(tokenStart, context) {
          const tokens = context.structure.tokens;
          const kind = tokens.kind(tokenStart);
          const inline = buildInlineFragment(tokenStart, false, context);
          const children = inline.children;
          const result: Heading = {
            type: "heading",
            depth: kind - BlockKind.SetextHeading1Open + 1 as Heading["depth"],
            children,
            position: {
              start: firstChildStart(children),
              end: context.locator.locationAt(tokens.end(tokenStart)),
            },
          };
          if (inline.attributes) {
            result.attributes = inline.attributes;
          }
          return result;
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
          const lineEnd = lines.end(start);
          out.push(BlockKind.AtxHeading1Open + atx.depth - 1, contentOffset, lineEnd);
          out.closeRange(atx.contentOffset, atx.contentEnd);
          return start + 1;
        },
      },
    ],
  },
};
