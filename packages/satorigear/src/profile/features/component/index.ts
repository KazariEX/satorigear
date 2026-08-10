import { blockRules, blockStarts } from "./block.ts";
import { inlineRules, inlineTokens, transformInlineCarrier } from "./inline.ts";
import type { SyntaxFeature } from "../../types.ts";

export const feature: SyntaxFeature = {
  blockRules,
  blockStarts,
  inlineRules,
  inlineStructures: [
    {
      kind: "container",
      token: "InlineComponentOpen",
      contentOpen: "InlineComponentLabelOpen",
      close: "InlineComponentLabelClose",
      rule: "InlineComponent",
      linkRule: "LinkComponent",
    },
    {
      kind: "pair",
      open: "InlineSpanOpen",
      close: "InlineSpanClose",
      rule: "InlineSpan",
      linkRule: "LinkSpan",
    },
  ],
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
