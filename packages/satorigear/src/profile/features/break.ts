import { BlockKind } from "../../block/kinds.ts";
import { blockEnd, firstNonspace } from "../../fragment/block.ts";
import { appendInline } from "../../fragment/inline.ts";
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
        build(nodeId, offset, tokenBase, context) {
          const end = offset + context.view.arena.lenOf(nodeId);
          return {
            type: "thematicBreak",
            position: {
              start: firstNonspace(context.source, offset, end),
              end: blockEnd(nodeId, offset, context),
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
        build(tokenIndex, sourceSpan, accumulator) {
          appendInline(
            accumulator,
            { type: "break", position: sourceSpan },
          );
          return true;
        },
      },
      {
        kind: "leaf",
        token: InlineKind.Newline,
        build(tokenIndex, sourceSpan, accumulator) {
          appendInline(
            accumulator,
            { type: "text", value: "\n", position: sourceSpan },
          );
          return true;
        },
      },
    ],
  },
};
