import { blockRules, blockStarts } from "./block.ts";
import { inlineTokens, transformInlineFootnotes } from "./inline.ts";
import type { SyntaxFeature } from "../../types.ts";

export const feature: SyntaxFeature = {
  block: {
    rules: blockRules,
    starts: blockStarts,
  },
  inline: {
    tokens: inlineTokens,
    transform: transformInlineFootnotes,
  },
};
