import type { Break, Text, ThematicBreak } from "mdast";
import { namedToken } from "../../block/tokens.ts";
import { appendInline, blockEnd, firstNonspace, withSpan } from "../../mdast.ts";
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
          token: "ThematicBreakToken",
        },
        project(nodeId, offset, tokenBase, context) {
          const end = offset + context.view.arena.lenOf(nodeId);
          return withSpan<ThematicBreak>(
            { type: "thematicBreak" },
            firstNonspace(context.source, offset, end),
            blockEnd(nodeId, offset, context),
          );
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
          out.push(namedToken("ThematicBreakToken", source.slice(line.start, line.end), line.start));
          return start + 1;
        },
      },
    ],
  },
  inline: {
    tokens: [
      {
        token: "HardBreak",
        project(tokenIndex, sourceSpan, accumulator) {
          appendInline(
            accumulator,
            withSpan<Break>({ type: "break" }, sourceSpan.start, sourceSpan.end),
          );
          return true;
        },
      },
      {
        token: "Newline",
        project(tokenIndex, sourceSpan, accumulator) {
          appendInline(
            accumulator,
            withSpan<Text>({ type: "text", value: "\n" }, sourceSpan.start, sourceSpan.end),
          );
          return true;
        },
      },
    ],
  },
};
