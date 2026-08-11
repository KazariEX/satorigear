import { blockRules, blockStarts } from "./block.ts";
import { inlineSyntax, transformFootnoteTokens } from "./inline.ts";
import type { SyntaxFeature } from "../../types.ts";

export const feature: SyntaxFeature = {
  block: {
    rules: blockRules,
    starts: blockStarts,
  },
  inline: {
    resolution: { transform: transformFootnoteTokens },
    syntax: inlineSyntax,
  },
};
