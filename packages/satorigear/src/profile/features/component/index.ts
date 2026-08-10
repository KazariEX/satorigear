import { blockRules, blockStarts } from "./block.ts";
import { inlineRules, inlineTokens, transformInlineCarrier } from "./inline.ts";
import type { SyntaxFeature } from "../../types.ts";

export const feature: SyntaxFeature = {
  blockRules,
  blockStarts,
  inlineRules,
  inlineTokens,
  inlineTransform: transformInlineCarrier,
  // Component contents form their own Markdown subtree, so delimiters cannot pair across its boundary.
  tokenPairs: [
    {
      opener: "InlineComponentLabelOpen",
      closer: "InlineComponentLabelClose",
      isolateDelimiters: true,
    },
    {
      opener: "InlineSpanOpen",
      closer: "InlineSpanClose",
      isolateDelimiters: true,
    },
  ],
};
