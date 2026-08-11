import { blockRules, blockStarts } from "./block.ts";
import { inlineRules, inlineTokens, rewriteComponentTokens } from "./inline.ts";
import type { SyntaxFeature } from "../../types.ts";

export const feature: SyntaxFeature = {
  block: {
    rules: blockRules,
    starts: blockStarts,
  },
  inline: {
    rules: inlineRules,
    structures: [
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
    tokens: inlineTokens,
    rewriteTokens: rewriteComponentTokens,
    // Component contents form their own Markdown subtree, so delimiters cannot pair across its boundary.
    pairs: [
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
  },
};
