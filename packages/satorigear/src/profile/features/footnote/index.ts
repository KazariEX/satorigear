import { blockRules, blockStarts, blockUnwrappers } from "./block.ts";
import { inlineTokens, transformInlineFootnotes } from "./inline.ts";
import type { SyntaxFeature } from "../../types.ts";

export const feature: SyntaxFeature = {
  blockRules,
  blockStarts,
  blockUnwrappers,
  inlineTokens,
  inlineTransform: transformInlineFootnotes,
};
