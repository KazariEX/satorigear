import { blockBuilds, blockStarts } from "./block.ts";
import { createMathScanRule, inlineBuilds } from "./inline.ts";
import type { SyntaxFeature } from "../../types.ts";
import type { MathOptions } from "./types.ts";

export function feature(options: true | MathOptions): SyntaxFeature {
  const singleDollarTextMath = typeof options !== "object" || options.singleDollarTextMath !== false;
  return {
    block: {
      builds: blockBuilds,
      starts: blockStarts,
    },
    inline: {
      scans: [
        createMathScanRule(singleDollarTextMath),
      ],
      builds: inlineBuilds,
    },
  };
}
