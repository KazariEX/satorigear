import {
  type BlockLine,
  lineIndent,
  logicalToken,
  removeIndent,
} from "../../../block/primitives.ts";
import {
  blockEnd,
  blockToken,
  firstNonspace,
  lineEnd,
  withSpan,
} from "../../../mdast.ts";
import { semanticText } from "../text.ts";
import type { SyntaxFeature } from "../../types.ts";
import type { Math } from "./types.ts";

interface MathFence {
  length: number;
}

function mathFenceAt(source: string, line: BlockLine): MathFence | null {
  const indent = lineIndent(source, line);
  if (!indent || source[indent.offset] !== "$") {
    return null;
  }
  let offset = indent.offset;
  while (source[offset] === "$") {
    offset++;
  }
  const length = offset - indent.offset;
  if (length < 2) {
    return null;
  }
  for (; offset < line.end; offset++) {
    if (source[offset] === "$") {
      return null;
    }
  }
  return { length };
}

function closesMathFence(source: string, line: BlockLine, fence: MathFence): boolean {
  const indent = lineIndent(source, line);
  if (!indent || source[indent.offset] !== "$") {
    return false;
  }
  let offset = indent.offset;
  while (source[offset] === "$") {
    offset++;
  }
  if (offset - indent.offset < fence.length) {
    return false;
  }
  while (offset < line.end && (source[offset] === " " || source[offset] === "\t")) {
    offset++;
  }
  return offset === line.end;
}

function stripLineEnding(value: string): string {
  if (value.endsWith("\r\n")) {
    return value.slice(0, -2);
  }
  return value.endsWith("\r") || value.endsWith("\n") ? value.slice(0, -1) : value;
}

function mathBlock(value: string): { closed: boolean; node: Math } {
  const lines = value.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g)?.filter(Boolean);
  if (!lines?.length) {
    throw new Error("MathBlockToken is empty");
  }
  const opening = lines[0];
  let indent = 0;
  while (indent < 3 && opening[indent] === " ") {
    indent++;
  }
  let markerEnd = indent;
  while (opening[markerEnd] === "$") {
    markerEnd++;
  }
  const markerLength = markerEnd - indent;
  const content = lines.slice(1);
  const last = content.at(-1);
  const closing = last === void 0 ? void 0 : stripLineEnding(last);
  let closed = false;
  if (closing !== void 0) {
    let offset = 0;
    while (offset < 3 && closing[offset] === " ") {
      offset++;
    }
    const markerStart = offset;
    while (closing[offset] === "$") {
      offset++;
    }
    closed = offset - markerStart >= markerLength && /^[ \t]*$/.test(closing.slice(offset));
  }
  if (closed) {
    content.pop();
  }
  const meta = semanticText(stripLineEnding(opening.slice(markerEnd)).replace(/^[ \t]+/, ""));
  const contentValue = content.map((line) => removeIndent(line, indent)).join("");
  return {
    closed,
    node: {
      type: "math",
      meta: meta || null,
      value: stripLineEnding(contentValue),
    },
  };
}

export const blockRules: SyntaxFeature["blockRules"] = [
  {
    rule: "MathBlock",
    project(nodeId, offset, tokenBase, context) {
      const end = offset + context.view.arena.lenOf(nodeId);
      const math = mathBlock(blockToken(nodeId, tokenBase, "MathBlockToken", context).text);
      return withSpan(
        math.node,
        firstNonspace(context.source, offset, lineEnd(context.source, offset)),
        math.closed || end < context.source.length ? blockEnd(nodeId, offset, context) : end,
      );
    },
  },
];

export const blockStarts: SyntaxFeature["blockStarts"] = [
  {
    codes: [36],
    interrupt(source, line) {
      return mathFenceAt(source, line) !== null;
    },
    start(source, lines, start, out) {
      const fence = mathFenceAt(source, lines[start]);
      if (!fence) {
        return void 0;
      }
      let end = start + 1;
      while (end < lines.length && !closesMathFence(source, lines[end], fence)) {
        end++;
      }
      if (end < lines.length) {
        end++;
      }
      out.push(logicalToken("MathBlockToken", source, lines, start, end));
      return end;
    },
  },
];
