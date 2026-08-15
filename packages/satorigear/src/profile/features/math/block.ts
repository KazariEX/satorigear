import {
  closesFence,
  fenceAt,
  fencedBlock,
  type FencedBlock,
  fencedBlockContent,
  type FenceRule,
} from "../../../block/fence.ts";
import { BlockKind } from "../../../block/kinds.ts";
import { firstNonspace, lineEnd } from "../../../block/lines.ts";
import { appendLogicalToken } from "../../../block/tokens.ts";
import { Character } from "../../../constants/character.ts";
import { blockEnd, blockToken } from "../../../fragment/block.ts";
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
      token: BlockKind.MathBlockToken,
    },
    build(tokenStart, context) {
      const offset = context.structure.tokens.start(tokenStart);
      const end = offset + context.structure.lenOf(tokenStart);
      const token = blockToken(tokenStart, BlockKind.MathBlockToken, context);
      const value = context.structure.tokens.text(context.source, token);
      const block = context.structure.tokens.value<FencedBlock>(token);
      if (!block) {
        throw new Error("MathBlockToken has no fence metadata");
      }
      const meta = semanticText(block.info);
      return {
        type: "math",
        meta: meta || null,
        value: fencedBlockContent(value, block, "columns"),
        position: {
          start: firstNonspace(context.source, offset, lineEnd(context.source, offset)),
          end: block.closed || end < context.source.length ? blockEnd(tokenStart, context) : end,
        },
      };
    },
  },
];

export const blockStarts: BlockFeature["starts"] = [
  {
    codes: [
      Character.DollarSign,
    ],
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
      const closed = end < lines.length;
      if (end < lines.length) {
        end++;
      }
      appendLogicalToken(
        out,
        BlockKind.MathBlockToken,
        source,
        lines,
        start,
        end,
        fencedBlock(source, lines[start], fence, closed),
      );
      return end;
    },
  },
];
