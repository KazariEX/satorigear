import { createCompositeParser } from "monogram/composite-parser.ts";
import { type CstNode, getText } from "monogram/cst.ts";
import { createDelimitedTokenResolver } from "monogram/delimiter-parser.ts";
import { createCstParser } from "../../packages/satorigear/src/emitted-parser.ts";
import * as inlineRuntime from "../../packages/satorigear/src/generated/inline.ts";
import {
  markdownBracketPairs,
  markdownDelimiterRuns,
  normalizeMarkdownReferenceLabel,
  reassociateMarkdownReferenceTails,
} from "../../packages/satorigear/src/grammar-inline.ts";
import { markdownBlockParser } from "../../packages/satorigear/src/parser.ts";

const inlineParser = createCstParser(inlineRuntime, inlineRuntime.tokenize);
const inlineResolver = createDelimitedTokenResolver(markdownDelimiterRuns, markdownBracketPairs);

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

function inlineParserFor(labels: ReadonlySet<string>) {
  return {
    parse: (source: string, entryRule?: string) => {
      const tokens = reassociateMarkdownReferenceTails(source, inlineParser.tokenize(source), labels);
      return inlineParser.parseTokens(source, inlineResolver.resolve(source, tokens, { labels }), entryRule);
    },
  };
}

export const markdownPhasedParser = createCompositeParser({
  outer: markdownBlockParser,
  prepare: collectReferenceLabels,
  regions: [{
    within: ["Paragraph", "AtxHeading", "SetextHeading"],
    contentToken: "InlineChunk",
    inner: inlineParserFor,
    entryRule: "InlineLines",
  }],
});
