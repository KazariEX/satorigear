import { createFencedBlock } from "../../../block/fence.ts";
import { BlockKind } from "../../../constants/block.ts";
import { Character } from "../../../constants/character.ts";
import { semanticText } from "../../utils.ts";
import type { BlockFeature } from "../../../block/profile.ts";

const mathFence = createFencedBlock({
  kind: BlockKind.MathBlock,
  marker: Character.DollarSign,
  minimumLength: 2,
  allowMarkerInInfo: false,
});

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
        position: tokens.positionOf(tokenStart, context.locator),
      };
    },
  },
];

export const blockStarts: BlockFeature["starts"] = [
  mathFence,
];
