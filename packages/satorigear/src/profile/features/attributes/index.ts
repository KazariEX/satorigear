import { blockDecorators } from "./block.ts";
import { inlineBuilds, inlineScans } from "./inline.ts";
import type { SyntaxFeature } from "../../types.ts";

export const feature: SyntaxFeature = {
  block: {
    decorators: blockDecorators,
  },
  inline: {
    scans: inlineScans,
    builds: inlineBuilds,
  },
};
