import type { Heading } from "mdast";
import { type BlockLines, trimLineWhitespaceEnd, trimLineWhitespaceStart } from "../../block/lines.ts";
import { BlockKind } from "../../constants/block.ts";
import { Character } from "../../constants/character.ts";
import { buildInlineFragment } from "../../fragment/inline.ts";
import type { SyntaxFeature } from "../types.ts";

function atxMarkerEnd(source: string, markerOffset: number, lineEnd: number): number {
  let markerEnd = markerOffset + 1;
  while (
    markerEnd < lineEnd &&
    markerEnd - markerOffset < 6 &&
    source.charCodeAt(markerEnd) === Character.NumberSign
  ) {
    markerEnd++;
  }
  if (markerEnd < lineEnd) {
    const code = source.charCodeAt(markerEnd);
    if (code !== Character.Space && code !== Character.CharacterTabulation) {
      return 0;
    }
  }
  return markerEnd;
}

export function setextMarkerAt(
  source: string,
  lines: BlockLines,
  index: number,
  markerOffset: number,
): number | undefined {
  const marker = source.charCodeAt(markerOffset);
  if (marker !== Character.EqualsSign && marker !== Character.HyphenMinus) {
    return;
  }
  const lineEnd = lines.end(index);
  let offset = markerOffset + 1;
  while (offset < lineEnd && source.charCodeAt(offset) === marker) {
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
          const start = context.locator.locationAt(tokens.start(tokenStart));
          const inline = buildInlineFragment(tokenStart, false, context);
          const result: Heading = {
            type: "heading",
            depth: kind - BlockKind.AtxHeading1Open + 1 as Heading["depth"],
            children: inline.children,
            position: {
              start,
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
          const start = context.locator.locationAt(tokens.start(tokenStart));
          const inline = buildInlineFragment(tokenStart, false, context);
          const result: Heading = {
            type: "heading",
            depth: kind - BlockKind.SetextHeading1Open + 1 as Heading["depth"],
            children: inline.children,
            position: {
              start,
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
          return atxMarkerEnd(source, contentOffset, lines.end(index)) > 0;
        },
        start(source, lines, tokens, start, contentOffset) {
          const lineEnd = lines.end(start);
          const markerEnd = atxMarkerEnd(source, contentOffset, lineEnd);
          if (markerEnd <= 0) {
            return;
          }
          const contentStart = trimLineWhitespaceStart(source, markerEnd, lineEnd);
          let contentEnd = trimLineWhitespaceEnd(source, contentStart, lineEnd);
          let closer = contentEnd;
          let code = source.charCodeAt(closer - 1);
          while (closer > contentStart && code === Character.NumberSign) {
            closer--;
            code = source.charCodeAt(closer - 1);
          }
          if (
            closer < contentEnd && (
              closer === contentStart || code === Character.Space || code === Character.CharacterTabulation
            )
          ) {
            contentEnd = trimLineWhitespaceEnd(source, contentStart, closer);
          }
          tokens.push(BlockKind.AtxHeading1Open + markerEnd - contentOffset - 1, contentOffset, lineEnd);
          tokens.closeRange(contentStart, contentEnd);
          return start + 1;
        },
      },
    ],
  },
};
