import {
  closesFence,
  fenceAt,
  fencedBlock,
  type FencedBlock,
  type FenceRule,
  sourceColumnFenceContent,
} from "../../../block/fence.ts";
import { appendLogicalToken } from "../../../block/tokens.ts";
import { BlockKind } from "../../../constants/block.ts";
import { Character } from "../../../constants/character.ts";
import { fencedBlockPosition } from "../../../fragment/block.ts";
import { semanticText } from "../text.ts";
import type { BlockFeature } from "../../../block/profile.ts";

const mathFenceRule: FenceRule = {
  forbiddenInfoMarker: Character.DollarSign,
  marker: Character.DollarSign,
  minimumLength: 2,
};

export const blockBuilds: BlockFeature["builds"] = [
  {
    token: BlockKind.MathBlock,
    build(tokenStart, context) {
      const tokens = context.structure.tokens;
      // The math scanner records fence geometry on every emitted block token.
      const block = tokens.value<FencedBlock>(tokenStart)!;
      const value = block.content ?? tokens.text(context.source, tokenStart);
      const meta = semanticText(block.info);
      return {
        type: "math",
        meta: meta || null,
        value: sourceColumnFenceContent(value, block),
        position: fencedBlockPosition(tokenStart, block, context),
      };
    },
  },
];

export const blockStarts: BlockFeature["starts"] = [
  {
    codes: [
      Character.DollarSign,
    ],
    interrupt(source, lines, index, contentOffset) {
      return fenceAt(source, lines, index, mathFenceRule, contentOffset) !== void 0;
    },
    start(source, lines, start, contentOffset, out) {
      const fence = fenceAt(source, lines, start, mathFenceRule, contentOffset);
      if (!fence) {
        return;
      }
      let end = start + 1;
      while (end < lines.length && !closesFence(source, lines, end, fence)) {
        end++;
      }
      const closed = end < lines.length;
      if (end < lines.length) {
        end++;
      }
      appendLogicalToken(
        out,
        BlockKind.MathBlock,
        source,
        lines,
        start,
        end,
        fencedBlock(source, lines, start, end, fence, closed),
      );
      return end;
    },
  },
];
