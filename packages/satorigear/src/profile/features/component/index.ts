import { feature as block } from "./block.ts";
import { feature as inline } from "./inline.ts";
import type { SyntaxFeature } from "../../types.ts";

export function feature(attributes: boolean): SyntaxFeature {
  const blockFeature = block(attributes);
  return {
    blockRules: blockFeature.blockRules,
    blockStarts: blockFeature.blockStarts,
    inlineRules: inline.inlineRules,
    inlineTokens: inline.inlineTokens,
  };
}
