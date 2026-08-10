import { feature as block } from "./block.ts";
import { feature as inline } from "./inline.ts";
import type { SyntaxFeature } from "../../types.ts";

export const feature: SyntaxFeature = {
  blockRules: block.blockRules,
  blockStarts: block.blockStarts,
  inlineRules: inline.inlineRules,
  inlineTokens: inline.inlineTokens,
};
