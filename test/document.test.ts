import { describe, expect, it } from "vitest";
import { createParser } from "../packages/satorigear/src/index.ts";

const parser = createParser();

describe("markdown document", () => {
  it("keeps a parser profile fixed across documents", () => {
    const tableParser = createParser({ table: true });
    const source = "a | b\n--- | ---\nc | d\n";

    expect(tableParser.parse(source).children[0]).toMatchObject({ type: "table" });
    expect(tableParser.createDocument(source).snapshot()).toEqual(tableParser.parse(source));
    expect(parser.parse(source).children[0]).toMatchObject({ type: "paragraph" });
  });

  it("uses the document path for complete parsing", () => {
    const source = "# heading\n\nbody *text*\n";
    expect(parser.createDocument(source).snapshot()).toEqual(parser.parse(source));
  });

  it("applies a batch in old-document coordinates", () => {
    const document = parser.createDocument("one two three\n");
    const update = document.edit([
      { start: 0, end: 3, text: "1" },
      { start: 8, end: 13, text: "3" },
    ]);

    expect(document.source).toBe("1 two 3\n");
    expect(update.changedSpan).toEqual({ start: 0, end: 7 });
    expect(document.snapshot()).toEqual(parser.parse(document.source));
  });

  it("rejects invalid edit batches without changing the document", () => {
    const document = parser.createDocument("abcdef");

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
    const document = parser.createDocument("text\n");
    expect(document.edit([])).toEqual({ changedSpan: { start: 0, end: 0 } });
    expect(document.source).toBe("text\n");
  });

  it("recomputes reference availability across the document", () => {
    const document = parser.createDocument("[label]\n");
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

  it("reassociates adjacent references when a definition becomes available", () => {
    const document = parser.createDocument("[foo][bar][baz]\n\n[baz]: /baz\n");
    document.snapshot();
    document.edit([{
      start: document.source.length,
      end: document.source.length,
      text: "\n[bar]: /bar\n",
    }]);

    expect(document.snapshot()).toEqual(parser.parse(document.source));
  });

  it("restarts an earlier multiline definition candidate", () => {
    const document = parser.createDocument("[foo]\n>\nxxxbar\n");
    document.edit([{ start: 11, end: 14, text: "foo&]:&rl" }]);

    expect(document.snapshot()).toEqual(parser.parse(document.source));
    expect(document.snapshot().children[0]).toMatchObject({ type: "definition", identifier: "foo] > xxxfoo&" });
  });

  it("scopes batched inline forests around edited region arenas", () => {
    const document = parser.createDocument("one *a*\n\ntwo **b**\n");
    document.snapshot();
    document.edit([
      { start: 5, end: 6, text: "A" },
      { start: document.source.length, end: document.source.length, text: "\nthree [c](/c)\n\nfour `d`\n" },
    ]);

    expect(document.snapshot()).toEqual(parser.parse(document.source));
    const start = document.source.indexOf("three");
    document.edit([{ start, end: start + 5, text: "THREE" }]);
    expect(document.snapshot()).toEqual(parser.parse(document.source));
  });

  it("does not mutate an earlier mdast snapshot after edits", () => {
    const document = parser.createDocument("first\n\nsecond\n");
    const before = document.snapshot();
    const snapshot = structuredClone(before);

    document.edit([{ start: 0, end: 0, text: "heading\n\n" }]);
    const after = document.snapshot();

    expect(before).toEqual(snapshot);
    expect(after.children[2].position?.start.offset).toBeGreaterThan(before.children[1].position?.start.offset ?? 0);
  });

  it("applies consecutive edits before the next snapshot", () => {
    const document = parser.createDocument("one\n\ntwo\n\nthree\n");
    document.snapshot();

    document.edit([{ start: 0, end: 0, text: "# heading\n\n" }]);
    const start = document.source.indexOf("three");
    document.edit([{ start, end: start + 5, text: "THREE" }]);

    expect(document.snapshot()).toEqual(parser.parse(document.source));
  });

  it("isolates snapshots from user mutations", () => {
    const source = "# heading *text*\n\nbody\n";
    const document = parser.createDocument(source);
    const first = document.snapshot();
    const heading = first.children[0];
    if (heading?.type !== "heading") {
      throw new Error("Expected a heading");
    }
    const emphasis = heading.children[1];
    if (emphasis?.type !== "emphasis") {
      throw new Error("Expected emphasis in the heading");
    }
    const text = emphasis.children[0];
    if (text?.type !== "text") {
      throw new Error("Expected text in the emphasis");
    }
    if (!heading.position) {
      throw new Error("Expected the heading position");
    }

    heading.depth = 6;
    text.value = "changed";
    heading.children.splice(0, 1);
    heading.position.start.offset = 99;

    expect(heading.depth).toBe(6);
    expect(text.value).toBe("changed");
    expect(heading.children).toEqual([emphasis]);
    expect(heading.position.start.offset).toBe(99);

    const second = document.snapshot();
    expect(second).toEqual(parser.parse(source));
  });

  it("updates positions when edits join and split CRLF", () => {
    const joined = parser.createDocument("one\rrest\n\nlast\n");
    joined.edit([{ start: 4, end: 4, text: "\n" }]);
    expect(joined.snapshot()).toEqual(parser.parse(joined.source));

    const split = parser.createDocument("one\r\n\r\ntwo\rthree\n\nfour\n");
    split.edit([{ start: 3, end: 5, text: "\r" }]);
    expect(split.snapshot()).toEqual(parser.parse(split.source));
    split.edit([{ start: 0, end: 0, text: "\n" }]);
    expect(split.snapshot()).toEqual(parser.parse(split.source));
  });

  it("updates HTML block termination", () => {
    const document = parser.createDocument("<script>\nvalue\n");
    expect(document.snapshot().children[0]).toMatchObject({
      type: "html",
      value: "<script>\nvalue\n",
    });

    document.edit([{
      start: document.source.length,
      end: document.source.length,
      text: "</script>\n",
    }]);
    expect(document.snapshot()).toEqual(parser.parse(document.source));
    expect(document.snapshot().children[0]).toMatchObject({
      type: "html",
      value: "<script>\nvalue\n</script>",
    });
  });

  it.each([
    { source: "***\n", shape: { type: "thematicBreak" } },
    { source: "- item\n", shape: { type: "list" } },
    { source: "heading\n---\n", shape: { type: "heading", depth: 2 } },
    { source: "> ___\n", shape: { type: "blockquote", children: [{ type: "thematicBreak" }] } },
  ])("updates thematic break conflicts as $shape.type", ({ source, shape }) => {
    const document = parser.createDocument("paragraph\n");
    document.edit([{ start: 0, end: document.source.length, text: source }]);

    const tree = document.snapshot();
    expect(tree).toEqual(parser.parse(source));
    expect(tree.children[0]).toMatchObject(shape);
  });

  it.each([
    { name: "equal-length content", before: "item", after: "ITEM", omegaLine: 6 },
    { name: "inserted line ending", before: "lazy continuation\r\n", after: "lazy continuation\r\n\n", omegaLine: 7 },
    { name: "shortened line ending", before: "lazy continuation\r\n", after: "lazy continuation\r", omegaLine: 6 },
  ])("converges after $name edits without losing suffix positions", ({ before, after, omegaLine }) => {
    const document = parser.createDocument("head\r\n\r\n> - \titem\r\n>   lazy continuation\r\n\r\nomega\r\n\r\ntail\r\n");
    const start = document.source.indexOf(before);
    document.edit([{ start, end: start + before.length, text: after }]);

    const tree = document.snapshot();
    const omegaOffset = document.source.indexOf("omega");
    const omega = tree.children.find((child) => child.position?.start.offset === omegaOffset);
    expect(tree).toEqual(parser.parse(document.source));
    expect(omega?.position?.start).toEqual({ line: omegaLine, column: 1, offset: omegaOffset });
  });
});
