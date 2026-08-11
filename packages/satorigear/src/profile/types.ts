import type { BlockFeature, BlockProfile } from "../block/profile.ts";
import type { InlineFeature, InlineProfile } from "../inline/profile.ts";

export interface SyntaxFeature {
  block?: BlockFeature;
  inline?: InlineFeature;
}

export interface SyntaxProfile {
  block: BlockProfile;
  inline: InlineProfile;
}
