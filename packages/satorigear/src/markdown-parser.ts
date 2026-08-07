import { createCompositeParser } from "../../../vendors/monogram/src/composite-parser.ts";
import { createDelimiterParser } from "../../../vendors/monogram/src/delimiter-parser.ts";
import { createParser } from "../../../vendors/monogram/src/gen-parser.ts";
import { markdownBlockGrammar, tokenizeMarkdownBlocks } from "./markdown-blocks.ts";
import { markdownBracketPairs, markdownDelimiterRuns, markdownInlineGrammar } from "./markdown-inline.ts";

const blockParser = createParser(markdownBlockGrammar);
const inlineParser = createDelimiterParser(markdownInlineGrammar, markdownDelimiterRuns, markdownBracketPairs);

/**
 * Block-first Markdown parser under development. It runs beside the legacy single-pass grammar
 * until its CommonMark block baseline is high enough to become the package default.
 */
export const markdownPhasedParser = createCompositeParser({
  outer: blockParser,
  outerTokens: tokenizeMarkdownBlocks,
  regions: [{
    within: ["Paragraph", "AtxHeading", "SetextHeading"],
    contentToken: "InlineChunk",
    inner: inlineParser,
    entryRule: "InlineLines",
  }],
});
