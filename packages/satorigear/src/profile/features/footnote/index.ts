import { blockBuilds, blockStarts } from "./block.ts";
import { inlineBuilds } from "./inline.ts";
import type { SyntaxFeature } from "../../types.ts";

export const feature: SyntaxFeature = {
  block: {
    builds: blockBuilds,
    starts: blockStarts,
  },
  inline: {
    builds: inlineBuilds,
  },
};
