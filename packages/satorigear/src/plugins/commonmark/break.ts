import { named } from "../../block/scanner.ts";
import {
  appendInline,
  blockEnd,
  type BlockProjector,
  firstNonspace,
  type InlineLeafProjector,
  withSpan,
} from "../../mdast.ts";
import type { BlockLine, BlockStart } from "../profile.ts";

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

export function thematicBreakInterrupt(source: string, line: BlockLine, contentOffset: number): boolean {
  return isThematicBreak(source, line, contentOffset);
}

export const thematicBreakStart: BlockStart = (source, lines, start, out, contentOffset) => {
  const line = lines[start];
  if (!isThematicBreak(source, line, contentOffset)) {
    return void 0;
  }
  out.push(named("ThematicBreakToken", source.slice(line.start, line.end), line.start));
  return start + 1;
};

export const projectThematicBreak: BlockProjector = (nodeId, offset, _tokenBase, context) => {
  const end = offset + context.view.arena.lenOf(nodeId);
  return withSpan(
    { type: "thematicBreak" },
    firstNonspace(context.source, offset, end),
    blockEnd(nodeId, offset, context),
  );
};

export const projectInlineBreak: InlineLeafProjector = (_tokenIndex, sourceSpan, accumulator) => {
  appendInline(accumulator, withSpan({ type: "break" }, sourceSpan.start, sourceSpan.end), sourceSpan.start);
  return true;
};

export const projectInlineNewline: InlineLeafProjector = (_tokenIndex, sourceSpan, accumulator) => {
  appendInline(
    accumulator,
    withSpan({ type: "text", value: "\n" }, sourceSpan.start, sourceSpan.end),
    sourceSpan.start,
  );
  return true;
};
