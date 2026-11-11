import { appendFencedToken, closesFence, fenceAt, type FenceRule } from "../../../block/fence.ts";
import { BlockKind } from "../../../constants/block.ts";
import { Character } from "../../../constants/character.ts";
import { semanticText } from "../../utils.ts";
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
      const meta = semanticText(tokens.value<string>(tokenStart)!);
      return {
        type: "math",
        meta: meta || null,
        value: tokens.text(context.source, tokenStart),
        position: context.locator.positionAt(tokens.start(tokenStart), tokens.end(tokenStart)),
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
      appendFencedToken(
        source,
        lines,
        out,
        BlockKind.MathBlock,
        start,
        end,
        fence,
        closed,
        false,
      );
      return end;
    },
  },
];
