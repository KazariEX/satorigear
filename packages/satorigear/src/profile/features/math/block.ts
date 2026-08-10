import {
  closesFence,
  fenceAt,
  fencedBlockContent,
  type FenceRule,
  readFencedBlock,
} from "../../../block/fence.ts";
import { logicalToken } from "../../../block/tokens.ts";
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

const mathFenceRule: FenceRule = {
  forbiddenInfoMarkers: "$",
  markers: "$",
  minimumLength: 2,
};

function mathBlock(value: string): { closed: boolean; node: Math } {
  const block = readFencedBlock(value, mathFenceRule);
  const meta = semanticText(block.info);
  return {
    closed: block.closed,
    node: {
      type: "math",
      meta: meta || null,
      value: fencedBlockContent(value, block, "columns"),
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
      return fenceAt(source, line, mathFenceRule) !== void 0;
    },
    start(source, lines, start, out) {
      const fence = fenceAt(source, lines[start], mathFenceRule);
      if (!fence) {
        return;
      }
      let end = start + 1;
      while (end < lines.length && !closesFence(source, lines[end], fence)) {
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
