import { describe, expect, it } from "vitest";
import { createMarkdownDocument, markdownToMdast } from "../packages/satorigear/src/index.ts";

describe("markdown document", () => {
  it("uses the document path for complete parsing", () => {
    const source = "# heading\n\nbody *text*\n";
    expect(createMarkdownDocument(source).toMdast()).toEqual(markdownToMdast(source));
  });

  it("applies a batch in old-document coordinates", () => {
    const document = createMarkdownDocument("one two three\n");
    const update = document.edit([
      { start: 0, end: 3, text: "1" },
      { start: 8, end: 13, text: "3" },
    ]);

    expect(document.source).toBe("1 two 3\n");
    expect(update.changedRange).toEqual({ start: 0, end: 7 });
    expect(document.toMdast()).toEqual(markdownToMdast(document.source));
  });

  it("rejects invalid edit batches without changing the document", () => {
    const document = createMarkdownDocument("abcdef");

    expect(() => document.edit([
      { start: 3, end: 5, text: "x" },
      { start: 1, end: 2, text: "y" },
    ])).toThrow("sorted");
    expect(() => document.edit([
      { start: 1, end: 4, text: "x" },
      { start: 3, end: 5, text: "y" },
    ])).toThrow("overlap");
    expect(() => document.edit([{ start: 0, end: 7, text: "" }])).toThrow("outside");
    expect(document.source).toBe("abcdef");
  });

  it("accepts an empty edit batch as a no-op", () => {
    const document = createMarkdownDocument("text\n");
    expect(document.edit([])).toEqual({ changedRange: { start: 0, end: 0 } });
    expect(document.source).toBe("text\n");
  });
});
