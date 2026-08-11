import { blockRules, blockStarts } from "./block.ts";
import { inlineSyntax, transformComponentTokens } from "./inline.ts";
import type { SyntaxFeature } from "../../types.ts";

export const feature: SyntaxFeature = {
  block: {
    rules: blockRules,
    starts: blockStarts,
  },
  inline: {
    syntax: inlineSyntax,
    resolution: {
      transform: transformComponentTokens,
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
  },
};
