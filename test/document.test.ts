import { describe, expect, it } from "vitest";
import { createParser } from "../packages/satorigear/src/index.ts";

const parser = createParser();

describe("markdown document", () => {
  it("keeps a parser profile fixed across documents", () => {
    const tableParser = createParser({ features: { table: true } });
    const source = "a | b\n--- | ---\nc | d\n";

    expect(tableParser.parse(source).children[0]).toMatchObject({ type: "table" });
    expect(tableParser.createDocument(source).tree).toEqual(tableParser.parse(source));
    expect(parser.parse(source).children[0]).toMatchObject({ type: "paragraph" });
  });

  it("uses the document path for complete parsing", () => {
    const source = "# heading\n\nbody *text*\n";
    expect(parser.createDocument(source).tree).toEqual(parser.parse(source));
  });

  it("applies a batch in old-document coordinates", () => {
    const document = parser.createDocument("one two three\n");
    const update = document.edit([
      { start: 0, end: 3, text: "1" },
      { start: 8, end: 13, text: "3" },
    ]);

    expect(document.source).toBe("1 two 3\n");
    expect(update.changedSpan).toEqual({ start: 0, end: 7 });
    expect(document.tree).toEqual(parser.parse(document.source));
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
    expect(document.tree.children[0]).toMatchObject({
      type: "paragraph",
      children: [{ type: "text", value: "[label]" }],
    });

    document.edit([{ start: document.source.length, end: document.source.length, text: "\n[label]: /url\n" }]);
    expect(document.tree.children[0]).toMatchObject({
      type: "paragraph",
      children: [{ type: "linkReference", identifier: "label" }],
    });
  });

  it("matches complete parses while appending streamed chunks", () => {
    const streamParser = createParser({
      features: {
        footnote: true,
        frontmatter: true,
        math: true,
      },
    });
    const document = streamParser.createDocument("");
    const chunks = [
      "---\n",
      "title: stream\n",
      "---\n\n",
      "[target]",
      "\n\n[target]: /url",
      "\r",
      "\n\n[^note]",
      "\n\n[^note]: streamed",
      "\n\n$$\nx",
      "\n$$\n",
      "\n### repeated\n",
      "\nbody\n",
      "\n### repeated\n",
    ];

    for (const text of chunks) {
      const start = document.source.length;
      document.edit([{ start, end: start, text }]);
      expect(document.tree).toEqual(streamParser.parse(document.source));
    }
  });

  it("reassociates adjacent references when a definition becomes available", () => {
    const document = parser.createDocument("[foo][bar][baz]\n\n[baz]: /baz\n");
    document.edit([{
      start: document.source.length,
      end: document.source.length,
      text: "\n[bar]: /bar\n",
    }]);

    expect(document.tree).toEqual(parser.parse(document.source));
  });

  it("restarts an earlier multiline definition candidate", () => {
    // A link label ends at the first unescaped "]",
    // so the candidate must avoid interior brackets until the edit closes it.
    const document = parser.createDocument("[alpha\nxxxdelta\n");
    document.edit([{ start: 10, end: 15, text: "delta]: /u" }]);

    expect(document.tree).toEqual(parser.parse(document.source));
    expect(document.tree.children[0]).toMatchObject({ type: "definition", identifier: "alpha xxxdelta" });
  });

  it("expands a rescan when edited syntax crosses old block boundaries", () => {
    const source = "before\n\n```\ncode\n```\n\none\n\ntwo\n\nthree\n";
    const document = parser.createDocument(source);
    const closer = source.indexOf("```", source.indexOf("```") + 3);

    document.edit([{ start: closer, end: closer + 3, text: "not" }]);

    expect(document.tree).toEqual(parser.parse(document.source));
  });

  it("isolates independently edited inline regions", () => {
    const document = parser.createDocument("one *a*\n\ntwo **b**\n");
    document.edit([
      { start: 5, end: 6, text: "A" },
      { start: document.source.length, end: document.source.length, text: "\nthree [c](/c)\n\nfour `d`\n" },
    ]);

    expect(document.tree).toEqual(parser.parse(document.source));
    const start = document.source.indexOf("three");
    document.edit([{ start, end: start + 5, text: "THREE" }]);
    expect(document.tree).toEqual(parser.parse(document.source));
  });

  it("mutates the document-owned tree after edits", () => {
    const document = parser.createDocument("first\n\nsecond\n");
    const tree = document.tree;
    const children = tree.children;
    const second = tree.children[1];

    document.edit([{ start: 0, end: 0, text: "heading\n\n" }]);

    expect(tree).toEqual(parser.parse(document.source));
    expect(tree.children).toBe(children);
    expect(tree.children[2]).toBe(second);
    expect(document.tree).toBe(tree);
  });

  it("applies consecutive edits to the owned tree", () => {
    const document = parser.createDocument("one\n\ntwo\n\nthree\n");

    document.edit([{ start: 0, end: 0, text: "# heading\n\n" }]);
    const start = document.source.indexOf("three");
    document.edit([{ start, end: start + 5, text: "THREE" }]);

    expect(document.tree).toEqual(parser.parse(document.source));
  });

  it("returns one stable document-owned tree", () => {
    const document = parser.createDocument("# heading *text*\n\nbody\n");
    const first = document.tree;
    expect(document.tree).toBe(first);

    document.edit([{ start: 2, end: 9, text: "title" }]);

    expect(document.tree).toBe(first);
    expect(first).toEqual(parser.parse(document.source));
  });

  it("updates positions when edits join and split CRLF", () => {
    const joined = parser.createDocument("one\rrest\n\nlast\n");
    joined.edit([{ start: 4, end: 4, text: "\n" }]);
    expect(joined.tree).toEqual(parser.parse(joined.source));

    const split = parser.createDocument("one\r\n\r\ntwo\rthree\n\nfour\n");
    split.edit([{ start: 3, end: 5, text: "\r" }]);
    expect(split.tree).toEqual(parser.parse(split.source));
    split.edit([{ start: 0, end: 0, text: "\n" }]);
    expect(split.tree).toEqual(parser.parse(split.source));
  });

  it("rebuilds the block touching a stable-prefix boundary", () => {
    const document = parser.createDocument("-1<.  \r\n>> ");
    document.edit([
      { start: 10, end: 10, text: "\n" },
      { start: 10, end: 10, text: "`" },
    ]);

    expect(document.tree).toEqual(parser.parse(document.source));
  });

  it("updates HTML block termination", () => {
    const document = parser.createDocument("<script>\nvalue\n");
    expect(document.tree.children[0]).toMatchObject({
      type: "html",
      value: "<script>\nvalue\n",
    });

    document.edit([{
      start: document.source.length,
      end: document.source.length,
      text: "</script>\n",
    }]);
    expect(document.tree).toEqual(parser.parse(document.source));
    expect(document.tree.children[0]).toMatchObject({
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

    const tree = document.tree;
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

    const tree = document.tree;
    const omegaOffset = document.source.indexOf("omega");
    const omega = tree.children.find((child) => child.position?.start.offset === omegaOffset);
    expect(tree).toEqual(parser.parse(document.source));
    expect(omega?.position?.start).toEqual({ line: omegaLine, column: 1, offset: omegaOffset });
  });
});
