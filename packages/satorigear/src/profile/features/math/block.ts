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
} from "../../../fragment/block.ts";
import { lineEnd } from "../../../fragment/inline.ts";
import { semanticText } from "../text.ts";
import type { BlockFeature } from "../../../block/profile.ts";

const mathFenceRule: FenceRule = {
  forbiddenInfoMarkers: "$",
  markers: "$",
  minimumLength: 2,
};

export const blockRules: BlockFeature["rules"] = [
  {
    rule: "MathBlock",
    syntax: {
      kind: "leaf",
      token: "MathBlockToken",
    },
    build(nodeId, offset, tokenBase, context) {
      const end = offset + context.view.arena.lenOf(nodeId);
      const value = blockToken(nodeId, tokenBase, "MathBlockToken", context).text;
      const block = readFencedBlock(value, mathFenceRule);
      const meta = semanticText(block.info);
      return {
        type: "math",
        meta: meta || null,
        value: fencedBlockContent(value, block, "columns"),
        position: {
          start: firstNonspace(context.source, offset, lineEnd(context.source, offset)),
          end: block.closed || end < context.source.length ? blockEnd(nodeId, offset, context) : end,
        },
      };
    },
  },
];

export const blockStarts: BlockFeature["starts"] = [
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
