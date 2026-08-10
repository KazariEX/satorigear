import { blockRules, blockStarts } from "./block.ts";
import { inlineTokens } from "./inline.ts";
import type { SyntaxFeature } from "../../types.ts";

export const feature: SyntaxFeature = {
  blockRules,
  blockStarts,
  inlineTokens,
};
