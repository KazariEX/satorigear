import { BlockKind, BlockRule } from "../../constants/block.ts";
import { Character } from "../../constants/character.ts";
import { InlineKind } from "../../constants/inline.ts";
import { blockEnd } from "../../fragment/block.ts";
import type { BlockLine } from "../../block/lines.ts";
import type { SyntaxFeature } from "../types.ts";

export function isThematicBreak(source: string, line: BlockLine, contentOffset: number): boolean {
  const marker = source[contentOffset];
  if (marker !== "*" && marker !== "-" && marker !== "_") {
    return false;
  }
  let count = 0;
  for (let offset = contentOffset; offset < line.end; offset++) {
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
        interrupt(source, line, contentOffset) {
          return isThematicBreak(source, line, contentOffset);
        },
        start(source, lines, start, out, contentOffset) {
          const line = lines[start];
          if (!isThematicBreak(source, line, contentOffset)) {
            return;
          }
          out.push(BlockKind.ThematicBreakToken, contentOffset, line.end);
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
