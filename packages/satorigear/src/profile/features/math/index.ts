import { blockRules, blockStarts } from "./block.ts";
import { inlineTokens, rewriteMathTokens } from "./inline.ts";
import type { SyntaxFeature } from "../../types.ts";
import type { MathOptions } from "./types.ts";

export function feature(options: true | MathOptions): SyntaxFeature {
  const singleDollarTextMath = typeof options !== "object" || options.singleDollarTextMath !== false;
  return {
    block: {
      rules: blockRules,
      starts: blockStarts,
    },
    inline: {
      tokens: inlineTokens,
      rewriteTokens: rewriteMathTokens.bind(void 0, singleDollarTextMath),
    },
  };
}
