import { createFence } from "../../../block/fence.ts";
import { Character } from "../../../constants/character.ts";
import { semanticText } from "../../utils.ts";
import type { BlockFeature } from "../../../block/profile.ts";

const fence = createFence({
  marker: Character.DollarSign,
  minimumLength: 2,
  normalizeEndings: false,
  allowMarkerInInfo: false,
});

export const blockStarts: BlockFeature["starts"] = [{
  codes: fence.codes,
  interrupt: fence.interrupt,
  start(source, lines, tokens, start, offset) {
    const match = fence.match(source, lines, start, offset);
    if (match) {
      return {
        node: {
          type: "math",
          meta: semanticText(match.info) || null,
          value: match.value,
          position: void 0,
        },
        nextLine: match.nextLine,
        start: offset,
        end: match.end,
      };
    }
  },
}];
