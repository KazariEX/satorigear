import { describe, expect, it } from "vitest";
import { createMarkdownBlockTokenizer } from "../packages/satorigear/src/grammar-blocks.ts";
import {
  createMarkdownCompositeDocument,
  markdownBlockParser,
  markdownPhasedParser,
} from "../packages/satorigear/src/parser.ts";

function setup(source: string) {
  const tokenizer = createMarkdownBlockTokenizer(source);
  const blocks = markdownBlockParser.createDocument(source, tokenizer.tokens);
  const composite = createMarkdownCompositeDocument(blocks.tree(tokenizer.tokens), source);
  return { blocks, composite, tokenizer };
}

describe("incremental inline regions", () => {
  it("retains every paragraph parser handle for an internal edit", () => {
    const source = "first *one*\n\nsecond **two**\n\nthird [three](/url)\n";
    const state = setup(source);
    const previous = state.composite.inlineDocuments();
    const start = source.indexOf("two");
    const edit = { start, end: start + 3, text: "changed" };
    const update = state.tokenizer.edit([edit]);
    state.blocks.edit([edit], update.change);
    state.composite.update(state.blocks.tree(state.tokenizer.tokens), state.tokenizer.source);

    const next = state.composite.inlineDocuments();
    expect(next).toEqual(previous);
    expect(state.composite.toCst()).toEqual(markdownPhasedParser.parse(state.tokenizer.source));
  });

  it("does not replace sibling item handles when one list item changes", () => {
    const source = "- first\n- second *item*\n- third\n";
    const state = setup(source);
    const previous = state.composite.inlineDocuments();
    const start = source.indexOf("second");
    const edit = { start, end: start + 6, text: "updated" };
    const update = state.tokenizer.edit([edit]);
    state.blocks.edit([edit], update.change);
    state.composite.update(state.blocks.tree(state.tokenizer.tokens), state.tokenizer.source);

    const next = state.composite.inlineDocuments();
    expect(next[0]).toBe(previous[0]);
    expect(next[1]).toBe(previous[1]);
    expect(next[2]).toBe(previous[2]);
    expect(state.composite.toCst()).toEqual(markdownPhasedParser.parse(state.tokenizer.source));
  });
});
