import { describe, expect, it } from "vitest";
import { createDocument, parse } from "../packages/satorigear/src/index.ts";

describe("markdown document", () => {
  it("uses the document path for complete parsing", () => {
    const source = "# heading\n\nbody *text*\n";
    expect(createDocument(source).snapshot()).toEqual(parse(source));
  });

  it("applies a batch in old-document coordinates", () => {
    const document = createDocument("one two three\n");
    const update = document.edit([
      { start: 0, end: 3, text: "1" },
      { start: 8, end: 13, text: "3" },
    ]);

    expect(document.source).toBe("1 two 3\n");
    expect(update.changedSpan).toEqual({ start: 0, end: 7 });
    expect(document.snapshot()).toEqual(parse(document.source));
  });

  it("rejects invalid edit batches without changing the document", () => {
    const document = createDocument("abcdef");

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
    const document = createDocument("text\n");
    expect(document.edit([])).toEqual({ changedSpan: { start: 0, end: 0 } });
    expect(document.source).toBe("text\n");
  });

  it("recomputes reference availability across the document", () => {
    const document = createDocument("[label]\n");
    expect(document.snapshot().children[0]).toMatchObject({
      type: "paragraph",
      children: [{ type: "text", value: "[label]" }],
    });

    document.edit([{ start: document.source.length, end: document.source.length, text: "\n[label]: /url\n" }]);
    expect(document.snapshot().children[0]).toMatchObject({
      type: "paragraph",
      children: [{ type: "linkReference", identifier: "label" }],
    });
  });

  it("restarts an earlier multiline definition candidate", () => {
    const document = createDocument("[foo]\n>\nxxxbar\n");
    document.edit([{ start: 11, end: 14, text: "foo&]:&rl" }]);

    expect(document.snapshot()).toEqual(parse(document.source));
    expect(document.snapshot().children[0]).toMatchObject({ type: "definition", identifier: "foo] > xxxfoo&" });
  });

  it("does not mutate an earlier mdast snapshot after edits", () => {
    const document = createDocument("first\n\nsecond\n");
    const before = document.snapshot();
    const snapshot = structuredClone(before);

    document.edit([{ start: 0, end: 0, text: "heading\n\n" }]);
    const after = document.snapshot();

    expect(before).toEqual(snapshot);
    expect(after.children[2].position?.start.offset).toBeGreaterThan(before.children[1].position?.start.offset ?? 0);
  });

  it("updates positions when edits join and split CRLF", () => {
    const joined = createDocument("one\rrest\n\nlast\n");
    joined.edit([{ start: 4, end: 4, text: "\n" }]);
    expect(joined.snapshot()).toEqual(parse(joined.source));

    const split = createDocument("one\r\n\r\ntwo\rthree\n\nfour\n");
    split.edit([{ start: 3, end: 5, text: "\r" }]);
    expect(split.snapshot()).toEqual(parse(split.source));
    split.edit([{ start: 0, end: 0, text: "\n" }]);
    expect(split.snapshot()).toEqual(parse(split.source));
  });
});
