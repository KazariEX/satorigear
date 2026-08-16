import { blockRules, blockStarts } from "./block.ts";
import { inlineBuilds, inlinePairs, inlineScans, transformComponentTokens } from "./inline.ts";
import type { SyntaxFeature } from "../../types.ts";

export const feature: SyntaxFeature = {
  block: {
    rules: blockRules,
    starts: blockStarts,
  },
  inline: {
    scan: inlineScans,
    resolve: {
      pairs: inlinePairs,
      transform: transformComponentTokens,
    },
    build: inlineBuilds,
  },
};
