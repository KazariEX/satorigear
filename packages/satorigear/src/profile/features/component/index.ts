import { blockBuilds, blockStarts } from "./block.ts";
import { inlineBuilds, inlineScans } from "./inline.ts";
import type { SyntaxFeature } from "../../types.ts";

export const feature: SyntaxFeature = {
  block: {
    builds: blockBuilds,
    starts: blockStarts,
  },
  inline: {
    scans: inlineScans,
    builds: inlineBuilds,
  },
};
