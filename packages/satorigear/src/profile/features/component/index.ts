import { blockRules, blockStarts } from "./block.ts";
import { inlineLexical, inlineSyntax, transformComponentTokens } from "./inline.ts";
import type { SyntaxFeature } from "../../types.ts";

export const feature: SyntaxFeature = {
  block: {
    rules: blockRules,
    starts: blockStarts,
  },
  inline: {
    lexical: inlineLexical,
    syntax: inlineSyntax,
    resolution: {
      transform: transformComponentTokens,
    },
  },
};
