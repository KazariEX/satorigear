import { blockQuotePlugin } from "./commonmark/blockquote.ts";
import { breakPlugin } from "./commonmark/break.ts";
import { codePlugin } from "./commonmark/code.ts";
import { emphasisPlugin } from "./commonmark/emphasis.ts";
import { headingPlugin } from "./commonmark/heading.ts";
import { htmlPlugin } from "./commonmark/html.ts";
import { linkPlugin } from "./commonmark/link.ts";
import { listPlugin } from "./commonmark/list.ts";
import { paragraphPlugin } from "./commonmark/paragraph.ts";
import { referencePlugin } from "./commonmark/reference.ts";
import { textPlugin } from "./commonmark/text.ts";
import { compileSyntaxProfile } from "./profile.ts";

export const commonmarkProfile = compileSyntaxProfile([
  headingPlugin,
  breakPlugin,
  blockQuotePlugin,
  listPlugin,
  codePlugin,
  htmlPlugin,
  referencePlugin,
  paragraphPlugin,
  textPlugin,
  emphasisPlugin,
  linkPlugin,
]);
