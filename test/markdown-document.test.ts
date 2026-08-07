import { describe, expect, it } from "vitest";
import { StatefulMarkdownDocument } from "../packages/satorigear/src/document.ts";
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

  it("recomputes reference availability across the document", () => {
    const document = createMarkdownDocument("[label]\n");
    expect(document.toMdast().children[0]).toMatchObject({
      type: "paragraph",
      children: [{ type: "text", value: "[label]" }],
    });

    document.edit([{ start: document.source.length, end: document.source.length, text: "\n[label]: /url\n" }]);
    expect(document.toMdast().children[0]).toMatchObject({
      type: "paragraph",
      children: [{ type: "linkReference", identifier: "label" }],
    });
  });

  it("does not mutate an earlier mdast snapshot after edits", () => {
    const document = createMarkdownDocument("first\n\nsecond\n");
    const before = document.toMdast();
    const snapshot = structuredClone(before);

    document.edit([{ start: 0, end: 0, text: "heading\n\n" }]);
    const after = document.toMdast();

    expect(before).toEqual(snapshot);
    expect(after.children[2].position?.start.offset).toBeGreaterThan(before.children[1].position?.start.offset ?? 0);
  });

  it("retains internal fragments for unrelated blocks", () => {
    const source = "one\n\ntwo\n\nthree\n\nfour\n\nfive\n";
    const document = new StatefulMarkdownDocument(source);
    document.toMdast();
    const before = document.fragmentObjects();
    const start = source.indexOf("three");

    document.edit([{ start, end: start + 5, text: "changed" }]);
    document.toMdast();
    const after = document.fragmentObjects();

    expect(after[0]).toBe(before[0]);
    expect(after[2]).not.toBe(before[2]);
    expect(after[4]).toBe(before[4]);
  });

  it("updates positions when edits join and split CRLF", () => {
    const joined = createMarkdownDocument("one\rrest\n\nlast\n");
    joined.edit([{ start: 4, end: 4, text: "\n" }]);
    expect(joined.toMdast()).toEqual(markdownToMdast(joined.source));

    const split = createMarkdownDocument("one\r\n\r\ntwo\rthree\n\nfour\n");
    split.edit([{ start: 3, end: 5, text: "\r" }]);
    expect(split.toMdast()).toEqual(markdownToMdast(split.source));
    split.edit([{ start: 0, end: 0, text: "\n" }]);
    expect(split.toMdast()).toEqual(markdownToMdast(split.source));
  });
});
