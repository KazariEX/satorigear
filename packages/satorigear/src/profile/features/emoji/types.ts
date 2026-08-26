import type { Literal } from "mdast";

export interface Emoji extends Literal {
  type: "emoji";
  /** Complete shortcode source, including both colons. */
  value: string;
}

declare module "mdast" {
  interface PhrasingContentMap {
    emoji: Emoji;
  }

  interface RootContentMap {
    emoji: Emoji;
  }
}
