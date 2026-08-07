import { tests } from "commonmark-spec";
import { describe, expect, it } from "vitest";
import {
  type BlockTextEdit,
  createMarkdownBlockTokenizer,
  tokenizeMarkdownBlocks,
} from "../packages/satorigear/src/grammar-blocks.ts";
import { markdownBlockParser } from "../packages/satorigear/src/parser.ts";

interface SpecCase {
  markdown: string;
}

function applyEdits(source: string, edits: readonly BlockTextEdit[]): string {
  const parts: string[] = [];
  let cursor = 0;
  for (const edit of edits) {
    parts.push(source.slice(cursor, edit.start), edit.text);
    cursor = edit.end;
  }
  parts.push(source.slice(cursor));
  return parts.join("");
}

describe("incremental block tokenization", () => {
  it("converges before unchanged trailing blocks", () => {
    const source = "one\n\ntwo\n\nthree\n\nfour\n\nfive\n";
    const tokenizer = createMarkdownBlockTokenizer(source);
    const update = tokenizer.edit([{ start: 10, end: 15, text: "changed" }]);

    expect(tokenizer.tokens).toEqual(tokenizeMarkdownBlocks(tokenizer.source));
    expect(update.scannedRange.start).toBeGreaterThan(0);
    expect(update.scannedRange.end).toBeLessThan(tokenizer.source.length);
  });

  it("lets an unterminated fence propagate to EOF", () => {
    const source = "before\n\n```\ncode\n```\n\nafter\n";
    const tokenizer = createMarkdownBlockTokenizer(source);
    const close = source.lastIndexOf("```");
    const update = tokenizer.edit([{ start: close, end: close + 3, text: "" }]);

    expect(tokenizer.tokens).toEqual(tokenizeMarkdownBlocks(tokenizer.source));
    expect(update.scannedRange.end).toBe(tokenizer.source.length);
  });

  it("handles old-coordinate batches, CRLF, tabs, and Unicode", () => {
    const source = "> α\r\n\r\n-\titem\r\n\r\nlast\r\n";
    const edits = [
      { start: 2, end: 3, text: "β" },
      { start: 8, end: 9, text: "  " },
      { start: source.length - 6, end: source.length - 6, text: "✨" },
    ];
    const tokenizer = createMarkdownBlockTokenizer(source);
    tokenizer.edit(edits);

    expect(tokenizer.source).toBe(applyEdits(source, edits));
    expect(tokenizer.tokens).toEqual(tokenizeMarkdownBlocks(tokenizer.source));
  });

  it("matches fresh tokenization for an edit in every CommonMark example", () => {
    for (const [index, test] of (tests as SpecCase[]).entries()) {
      const source = test.markdown.replace(/→/g, "\t");
      const end = source.search(/[\r\n]/);
      const offset = end < 0 ? source.length : end;
      const tokenizer = createMarkdownBlockTokenizer(source);
      const document = markdownBlockParser.createDocument(source, tokenizer.tokens);
      const edit = { start: offset, end: offset, text: "x" };
      const update = tokenizer.edit([edit]);
      document.edit([edit], update.change);
      expect(tokenizer.tokens, `CommonMark example ${index + 1}: ${JSON.stringify(source)}`)
        .toEqual(tokenizeMarkdownBlocks(tokenizer.source));
      expect(document.toCst(tokenizer.source, tokenizer.tokens), `CommonMark CST example ${index + 1}`)
        .toEqual(markdownBlockParser.parse(tokenizer.source));
    }
  });
});
