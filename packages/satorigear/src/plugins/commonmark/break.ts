import { appendInline, type InlineLeafProjector, withSpan } from "../../mdast.ts";

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
