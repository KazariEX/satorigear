import { BlockKind, BlockRule } from "../../constants/block.ts";
import { Character } from "../../constants/character.ts";
import { InlineKind } from "../../constants/inline.ts";
import { leafBlockPosition } from "../../fragment/block.ts";
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
    rules: [
      {
        rule: BlockRule.ThematicBreak,
        syntax: {
          kind: "leaf",
          token: BlockKind.ThematicBreak,
        },
        build(tokenStart, context) {
          return {
            type: "thematicBreak",
            position: leafBlockPosition(tokenStart, context),
          };
        },
      },
    ],
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
        start(source, lines, start, contentOffset, out) {
          if (!isThematicBreak(source, lines, start, contentOffset)) {
            return;
          }
          out.push(BlockKind.ThematicBreak, contentOffset, lines.end(start));
          return start + 1;
        },
      },
    ],
  },
  inline: {
    build: [
      {
        kind: "leaf",
        token: InlineKind.HardBreak,
        build(tokenIndex, sourceSpan) {
          return {
            type: "break",
            position: sourceSpan,
          };
        },
      },
      {
        kind: "text",
        token: InlineKind.Newline,
        build() {
          return "\n";
        },
      },
    ],
  },
};
