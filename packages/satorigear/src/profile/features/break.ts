import { Character } from "../../constants/character.ts";
import { InlineKind } from "../../constants/inline.ts";
import { inlineTokenData } from "../../inline/tokens.ts";
import type { BlockLines } from "../../block/lines.ts";
import type { SyntaxFeature } from "../types.ts";

export function isThematicBreak(
  source: string,
  lines: BlockLines,
  index: number,
  contentOffset: number,
): boolean {
  const marker = source.charCodeAt(contentOffset);
  if (
    marker !== Character.Asterisk &&
    marker !== Character.HyphenMinus &&
    marker !== Character.LowLine
  ) {
    return false;
  }
  let count = 0;
  for (let offset = contentOffset, end = lines.end(index); offset < end; offset++) {
    const code = source.charCodeAt(offset);
    if (code === marker) {
      count++;
    }
    else if (code !== Character.Space && code !== Character.CharacterTabulation) {
      return false;
    }
  }
  return count >= 3;
}

export const feature: SyntaxFeature = {
  block: {
    starts: [
      {
        codes: [
          Character.Asterisk,
          Character.HyphenMinus,
          Character.LowLine,
        ],
        interrupt(source, lines, index, contentOffset) {
          return isThematicBreak(source, lines, index, contentOffset);
        },
        start(source, lines, tokens, start, contentOffset) {
          if (!isThematicBreak(source, lines, start, contentOffset)) {
            return;
          }
          return {
            node: {
              type: "thematicBreak",
              position: void 0,
            },
            nextLine: start + 1,
            start: contentOffset,
            end: lines.end(start),
          };
        },
      },
    ],
  },
  inline: {
    builds: [
      {
        kind: "leaf",
        token: InlineKind.HardBreak,
        build(tokenIndex, position, context) {
          const lineStart = inlineTokenData(context.tokens, tokenIndex);
          return {
            type: "break",
            position: {
              start: position.start,
              end: context.locator.locationAt(context.view.mapOffset(lineStart - 1) + 1),
            },
          };
        },
      },
    ],
  },
};
