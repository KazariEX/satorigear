import { blockRules, blockStarts } from "./block.ts";
import { inlineRules, inlineTokens, transformInlineCarrier } from "./inline.ts";
import type { SyntaxFeature } from "../../types.ts";

export const feature: SyntaxFeature = {
  blockRules,
  blockStarts,
  inlineRules,
  inlineTokens,
  inlineTransform: transformInlineCarrier,
};
