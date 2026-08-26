import { BlockKind, BlockRule } from "../../constants/block.ts";
import { Character } from "../../constants/character.ts";
import { InlineKind } from "../../constants/inline.ts";
import { blockEnd } from "../../fragment/block.ts";
import type { BlockLines } from "../../block/lines.ts";
import type { SyntaxFeature } from "../types.ts";

export function isThematicBreak(
  source: string,
  lines: BlockLines,
  index: number,
  contentOffset: number,
): boolean {
  const marker = source[contentOffset];
  if (marker !== "*" && marker !== "-" && marker !== "_") {
    return false;
  }
  let count = 0;
  for (let offset = contentOffset, end = lines.end(index); offset < end; offset++) {
    const character = source[offset];
    if (character === marker) {
      count++;
    }
    else if (character !== " " && character !== "\t") {
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
          token: BlockKind.ThematicBreakToken,
        },
        build(tokenStart, context) {
          const tokens = context.structure.tokens;
          return {
            type: "thematicBreak",
            position: {
              start: tokens.start(tokenStart),
              end: blockEnd(tokenStart, context),
            },
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
          out.push(BlockKind.ThematicBreakToken, contentOffset, lines.end(start));
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
        kind: "leaf",
        token: InlineKind.Newline,
        build(tokenIndex, sourceSpan) {
          return {
            type: "text",
            value: "\n",
            position: sourceSpan,
          };
        },
      },
    ],
  },
};
