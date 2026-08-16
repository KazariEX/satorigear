import { blockRules, blockStarts } from "./block.ts";
import { inlineBuilds, inlineScans, transformComponentTokens } from "./inline.ts";
import type { SyntaxFeature } from "../../types.ts";

export const feature: SyntaxFeature = {
  block: {
    rules: blockRules,
    starts: blockStarts,
  },
  inline: {
    scan: inlineScans,
    resolve: {
      transform: transformComponentTokens,
    },
    build: inlineBuilds,
  },
};
