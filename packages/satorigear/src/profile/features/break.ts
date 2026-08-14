import { BlockKind } from "../../block/kinds.ts";
import { blockEnd, firstNonspace } from "../../fragment/block.ts";
import { InlineKind } from "../../inline/kinds.ts";
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
        rule: "ThematicBreak",
        syntax: {
          kind: "leaf",
          token: BlockKind.ThematicBreakToken,
        },
        build(tokenStart, context) {
          const offset = context.arena.tokens.start(tokenStart);
          const end = offset + context.arena.lenOf(tokenStart);
          return {
            type: "thematicBreak",
            position: {
              start: firstNonspace(context.source, offset, end),
              end: blockEnd(tokenStart, context),
            },
          };
        },
      },
    ],
    starts: [
      {
        codes: [42, 45, 95],
        interrupt(source, line, contentOffset) {
          return isThematicBreak(source, line, contentOffset);
        },
        start(source, lines, start, out, contentOffset) {
          const line = lines[start];
          if (!isThematicBreak(source, line, contentOffset)) {
            return;
          }
          out.push(BlockKind.ThematicBreakToken, line.start, line.end);
          return start + 1;
        },
      },
    ],
  },
  inline: {
    syntax: [
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
