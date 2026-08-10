import type { Literal } from "mdast";

export interface MathOptions {
  singleDollarTextMath?: boolean;
}

export interface Math extends Literal {
  type: "math";
  meta: string | null;
}

export interface InlineMath extends Literal {
  type: "inlineMath";
}

declare module "mdast" {
  interface BlockContentMap {
    math: Math;
  }

  interface PhrasingContentMap {
    inlineMath: InlineMath;
  }

  interface RootContentMap {
    inlineMath: InlineMath;
    math: Math;
  }
}
