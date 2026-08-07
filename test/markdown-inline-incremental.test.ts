import { describe, expect, it } from "vitest";
import { createMarkdownBlockTokenizer } from "../packages/satorigear/src/grammar-blocks.ts";
import {
  markdownCstToMdast,
  markdownFragmentsToMdast,
  markdownSyntaxBlockToMdastFragment,
} from "../packages/satorigear/src/mdast.ts";
import {
  createMarkdownCompositeDocument,
  markdownBlockParser,
} from "../packages/satorigear/src/parser.ts";
import { markdownPhasedParser } from "./support/markdown-phased-parser.ts";

function setup(source: string) {
  const tokenizer = createMarkdownBlockTokenizer(source);
  const blocks = markdownBlockParser.createDocument(source, tokenizer.tokens);
  const composite = createMarkdownCompositeDocument(blocks.tree(tokenizer.tokens), source);
  return { blocks, composite, tokenizer };
}

function editState(state: ReturnType<typeof setup>, edit: { end: number; start: number; text: string }): void {
  const update = state.tokenizer.edit([edit]);
  state.blocks.edit([edit], update.change);
  state.composite.update(state.blocks.tree(state.tokenizer.tokens), state.tokenizer.source);
}

function expectSemanticTree(state: ReturnType<typeof setup>): void {
  const source = state.tokenizer.source;
  const actual = markdownFragmentsToMdast(state.composite.blocks().map((block) => ({
    fragment: markdownSyntaxBlockToMdastFragment(block.node, source, block.syntax),
    offset: block.offset,
  })), source);
  const expected = markdownCstToMdast(markdownPhasedParser.parse(source), source);
  expect(actual).toEqual(expected);
}

describe("incremental inline regions", () => {
  it("retains every paragraph parser handle for an internal edit", () => {
    const source = "first *one*\n\nsecond **two**\n\nthird [three](/url)\n";
    const state = setup(source);
    const previous = state.composite.inlineDocuments();
    const start = source.indexOf("two");
    const edit = { start, end: start + 3, text: "changed" };
    editState(state, edit);

    const next = state.composite.inlineDocuments();
    expect(next).toEqual(previous);
    expectSemanticTree(state);
  });

  it("does not replace sibling item handles when one list item changes", () => {
    const source = "- first\n- second *item*\n- third\n";
    const state = setup(source);
    const previous = state.composite.inlineDocuments();
    const start = source.indexOf("second");
    const edit = { start, end: start + 6, text: "updated" };
    editState(state, edit);

    const next = state.composite.inlineDocuments();
    expect(next[0]).toBe(previous[0]);
    expect(next[1]).toBe(previous[1]);
    expect(next[2]).toBe(previous[2]);
    expectSemanticTree(state);
  });

  it("invalidates only regions that name a changed reference", () => {
    const state = setup("[foo]\n\n[bar]\n\nplain\n");
    expect(state.composite.inlineRevisions()).toEqual([0, 0, 0]);

    editState(state, {
      start: state.tokenizer.source.length,
      end: state.tokenizer.source.length,
      text: "\n[foo]: /url\n",
    });
    expect(state.composite.inlineRevisions()).toEqual([1, 0, 0]);

    const url = state.tokenizer.source.indexOf("/url");
    editState(state, { start: url, end: url + 4, text: "/next" });
    expect(state.composite.inlineRevisions()).toEqual([1, 0, 0]);

    editState(state, {
      start: state.tokenizer.source.length,
      end: state.tokenizer.source.length,
      text: "[bar]: /bar\n",
    });
    expect(state.composite.inlineRevisions()).toEqual([1, 1, 0]);
    expectSemanticTree(state);
  });

  it("keeps a reference region when a duplicate definition takes over", () => {
    const source = "[foo]\n\n[foo]: /first\n[foo]: /second\n";
    const state = setup(source);
    const start = source.indexOf("[foo]: /first");
    const end = source.indexOf("\n", start) + 1;

    editState(state, { start, end, text: "" });

    expect(state.composite.inlineRevisions()).toEqual([0]);
    expectSemanticTree(state);
  });
});
