import { createCompositeParser } from "monogram/composite-parser.ts";
import { type CstNode, getText } from "monogram/cst.ts";
import { resolveDelimitedTokens } from "monogram/delimiter-parser.ts";
import { createLexer } from "monogram/gen-lexer.ts";
import { createCstParser } from "./emitted-parser.ts";
import * as blockRuntime from "./generated/blocks.ts";
import * as inlineRuntime from "./generated/inline.ts";
import { tokenizeMarkdownBlocks } from "./grammar-blocks.ts";
import {
  markdownBracketPairs,
  markdownDelimiterRuns,
  markdownInlineGrammar,
  normalizeMarkdownReferenceLabel,
  reassociateMarkdownReferenceTails,
} from "./grammar-inline.ts";

const blockParser = createCstParser(blockRuntime, tokenizeMarkdownBlocks);
const inlineParser = createCstParser(inlineRuntime, createLexer(markdownInlineGrammar).tokenize);

function referenceLabel(definition: CstNode, source: string): string | null {
  const text = getText(definition, source);
  const open = text.indexOf("[");
  if (open < 0) {
    return null;
  }
  for (let offset = open + 1; offset < text.length; offset++) {
    if (text[offset] === "\\") {
      offset++;
    }
    else if (text[offset] === "]") {
      return normalizeMarkdownReferenceLabel(text.slice(open + 1, offset));
    }
  }
  return null;
}

function collectReferenceLabels(root: CstNode, source: string): Set<string> {
  const labels = new Set<string>();
  const visit = (node: CstNode): void => {
    if (node.rule === "LinkDefinition") {
      const label = referenceLabel(node, source);
      if (label) {
        labels.add(label);
      }
      return;
    }
    for (const child of node.children) {
      if (!("tokenType" in child)) {
        visit(child);
      }
    }
  };
  visit(root);
  return labels;
}

/**
 * Block-first Markdown parser under development. It runs beside the legacy single-pass grammar
 * until its CommonMark block baseline is high enough to become the package default.
 */
export const markdownPhasedParser = createCompositeParser({
  outer: blockParser,
  prepare: collectReferenceLabels,
  regions: [{
    within: ["Paragraph", "AtxHeading", "SetextHeading"],
    contentToken: "InlineChunk",
    inner: (referenceLabels) => ({
      parse: (source, entryRule) => {
        const pairs = markdownBracketPairs(referenceLabels);
        const tokens = reassociateMarkdownReferenceTails(source, inlineParser.tokenize(source), referenceLabels);
        return inlineParser.parseTokens(source, resolveDelimitedTokens(source, tokens, markdownDelimiterRuns, pairs), entryRule);
      },
    }),
    entryRule: "InlineLines",
  }],
});
