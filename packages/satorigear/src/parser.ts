import { createCompositeParser, rebaseCst } from "monogram/composite-parser.ts";
import { type CstNode, getText } from "monogram/cst.ts";
import { resolveDelimitedTokens } from "monogram/delimiter-parser.ts";
import { createLexer } from "monogram/gen-lexer.ts";
import { createSourceView, type SourceRange, type SourceView } from "monogram/source-view.ts";
import { createCstParser, type CstTree, type CstTreeNode, materializeCst } from "./emitted-parser.ts";
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

export const markdownBlockParser = createCstParser(blockRuntime, tokenizeMarkdownBlocks);
const inlineParser = createCstParser(inlineRuntime, createLexer(markdownInlineGrammar).tokenize);

function referenceLabel(definition: CstNode, source: string): string | null {
  return referenceLabelText(getText(definition, source));
}

function referenceLabelText(text: string): string | null {
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

function sameLabels(previous: ReadonlySet<string>, next: ReadonlySet<string>): boolean {
  return previous.size === next.size && [...previous].every((label) => next.has(label));
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

function collectTreeReferenceLabels(tree: CstTree, source: string): Set<string> {
  const labels = new Set<string>();
  const visit = (node: CstTreeNode): void => {
    if (tree.ruleName(node) === "LinkDefinition") {
      const span = tree.span(node);
      const label = referenceLabelText(source.slice(span.start, span.end));
      if (label) {
        labels.add(label);
      }
      return;
    }
    for (const child of tree.children(node)) {
      if (child.kind === "node") {
        visit(child);
      }
    }
  };
  visit(tree.root);
  return labels;
}

function inlineParserFor(referenceLabels: ReadonlySet<string>) {
  return {
    parse: (source: string, entryRule?: string) => {
      const pairs = markdownBracketPairs(referenceLabels);
      const tokens = reassociateMarkdownReferenceTails(source, inlineParser.tokenize(source), referenceLabels);
      return inlineParser.parseTokens(source, resolveDelimitedTokens(source, tokens, markdownDelimiterRuns, pairs), entryRule);
    },
  };
}

/**
 * Block-first Markdown parser under development. It runs beside the legacy single-pass grammar
 * until its CommonMark block baseline is high enough to become the package default.
 */
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

interface InlineRegion {
  inner: CstNode;
  text: string;
  view: SourceView;
}

function rangesOf(tree: CstTree, node: CstTreeNode): SourceRange[] {
  return tree.children(node).flatMap((child) => {
    if (child.kind === "node" || tree.leafTokenType(child) !== "InlineChunk") {
      return [];
    }
    const token = tree.leafToken(child);
    return token.ranges?.length ? [...token.ranges] : [{ offset: token.offset, end: token.offset + token.text.length }];
  });
}

class MarkdownCompositeDocument {
  #labels = new Set<string>();
  #regions = new Map<number, InlineRegion>();
  #source: string;
  #tree: CstTree;

  constructor(tree: CstTree, source: string) {
    this.#tree = tree;
    this.#source = source;
    this.update(tree, source);
  }

  update(tree: CstTree, source: string): void {
    const labels = collectTreeReferenceLabels(tree, source);
    const labelsChanged = !sameLabels(this.#labels, labels);
    const regions = new Map<number, InlineRegion>();
    const visit = (node: CstTreeNode): void => {
      const rule = tree.ruleName(node);
      if (rule === "Paragraph" || rule === "AtxHeading" || rule === "SetextHeading") {
        const ranges = rangesOf(tree, node);
        if (ranges.length > 0) {
          const view = createSourceView(source, ranges);
          const previous = this.#regions.get(node.id);
          const inner = !labelsChanged && previous?.text === view.text
            ? previous.inner
            : inlineParserFor(labels).parse(view.text, "InlineLines");
          regions.set(node.id, { inner, text: view.text, view });
        }
        return;
      }
      for (const child of tree.children(node)) {
        if (child.kind === "node") {
          visit(child);
        }
      }
    };
    visit(tree.root);
    this.#tree = tree;
    this.#source = source;
    this.#labels = labels;
    this.#regions = regions;
  }

  toCst(): CstNode {
    const root = materializeCst(this.#tree, this.#source);
    const attach = (arenaNode: CstTreeNode, node: CstNode): void => {
      const region = this.#regions.get(arenaNode.id);
      if (region) {
        const inner = rebaseCst(region.inner, region.view);
        let inserted = false;
        node.children = node.children.flatMap((child) => {
          if (!("tokenType" in child) || child.tokenType !== "InlineChunk") {
            return [child];
          }
          if (inserted) {
            return [];
          }
          inserted = true;
          return [inner];
        });
        return;
      }
      const arenaChildren = this.#tree.children(arenaNode);
      for (let index = 0; index < arenaChildren.length; index++) {
        const arenaChild = arenaChildren[index];
        const child = node.children[index];
        if (arenaChild.kind === "node" && child && !("tokenType" in child)) {
          attach(arenaChild, child);
        }
      }
    };
    attach(this.#tree.root, root);
    return root;
  }
}

export function createMarkdownCompositeDocument(tree: CstTree, source: string): MarkdownCompositeDocument {
  return new MarkdownCompositeDocument(tree, source);
}
