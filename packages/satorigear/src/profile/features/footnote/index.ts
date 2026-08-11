import { blockRules, blockStarts } from "./block.ts";
import { inlineTokens, rewriteFootnoteTokens } from "./inline.ts";
import type { SyntaxFeature } from "../../types.ts";

export const feature: SyntaxFeature = {
  block: {
    rules: blockRules,
    starts: blockStarts,
  },
  inline: {
    tokens: inlineTokens,
    rewriteTokens: rewriteFootnoteTokens,
  },
};
