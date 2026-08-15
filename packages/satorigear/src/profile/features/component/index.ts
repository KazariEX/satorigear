import { InlineKind } from "../../../inline/kinds.ts";
import { blockRules, blockStarts } from "./block.ts";
import { inlineLexical, inlineSyntax, transformComponentTokens } from "./inline.ts";
import type { SyntaxFeature } from "../../types.ts";

export const feature: SyntaxFeature = {
  block: {
    rules: blockRules,
    starts: blockStarts,
  },
  inline: {
    lexical: inlineLexical,
    syntax: inlineSyntax,
    resolution: {
      transform: transformComponentTokens,
      // Component contents form their own Markdown subtree, so delimiters cannot pair across its boundary.
      pairs: [
        {
          opener: InlineKind.InlineComponentLabelOpen,
          closer: InlineKind.InlineComponentLabelClose,
          isolateDelimiters: true,
        },
        {
          opener: InlineKind.InlineSpanOpen,
          closer: InlineKind.InlineSpanClose,
          isolateDelimiters: true,
        },
      ],
    },
  },
};
