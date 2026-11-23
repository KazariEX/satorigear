import { describe, expect, it } from "vitest";
import { createParser } from "../packages/satorigear/src/index.ts";

const parser = createParser();

describe("markdown document", () => {
  it("parses tables only when enabled", () => {
    const tableParser = createParser({ features: { table: true } });
    const source = "a | b\n--- | ---\nc | d\n";

    expect(tableParser.parse(source).children[0]).toMatchObject({ type: "table" });
    expect(tableParser.createDocument(source).tree).toEqual(tableParser.parse(source));
    expect(parser.parse(source).children[0]).toMatchObject({ type: "paragraph" });
  });

  it("applies each edit at its offset in the original source", () => {
    const document = parser.createDocument("one two three\n");
    const update = document.edit([
      { start: 0, end: 3, text: "1" },
      { start: 8, end: 13, text: "3" },
    ]);

    expect(document.source).toBe("1 two 3\n");
    expect(update.changedSpan).toEqual({ start: 0, end: 7 });
    expect(document.tree).toEqual(parser.parse(document.source));
  });

  it("accepts an empty edit batch as a no-op", () => {
    const document = parser.createDocument("text\n");
    expect(document.edit([])).toEqual({ changedSpan: { start: 0, end: 0 } });
    expect(document.source).toBe("text\n");
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

  it("updates the existing tree in place", () => {
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

  it("replaces the whole document with a quoted thematic break", () => {
    const document = parser.createDocument("paragraph\n");
    const source = "> ___\n";
    document.edit([{ start: 0, end: document.source.length, text: source }]);

    expect(document.tree.children).toMatchObject([
      { type: "blockquote", children: [{ type: "thematicBreak" }] },
    ]);
    expect(document.tree).toEqual(parser.parse(source));
  });

  it("turns a paragraph into a setext heading and back", () => {
    const document = parser.createDocument("alpha\nbeta");
    document.edit([{ start: 6, end: 6, text: "  " }]);
    expect(document.tree).toEqual(parser.parse(document.source));
    expect(document.tree.children[0]).toMatchObject({
      type: "paragraph",
      children: [{ value: "alpha\nbeta", position: { end: { line: 2, column: 7, offset: 12 } } }],
    });

    document.edit([{ start: 6, end: 8, text: "" }]);
    expect(document.tree).toEqual(parser.parse("alpha\nbeta"));
    document.edit([{ start: 10, end: 10, text: "\n---" }]);
    expect(document.tree).toEqual(parser.parse(document.source));
    expect(document.tree.children[0]).toMatchObject({
      type: "heading",
      depth: 2,
      children: [{ value: "alpha\nbeta" }],
      position: { end: { line: 3, column: 4, offset: 14 } },
    });
    document.edit([{ start: 10, end: 14, text: "" }]);
    expect(document.tree).toEqual(parser.parse("alpha\nbeta"));
  });

  it("updates ATX heading depth, text, and position", () => {
    const document = parser.createDocument("  ### title ###  \n\nsuffix");
    expect(document.tree.children[0]).toMatchObject({
      type: "heading",
      depth: 3,
      children: [{ value: "title" }],
      position: {
        start: { line: 1, column: 3, offset: 2 },
        end: { line: 1, column: 18, offset: 17 },
      },
    });

    document.edit([{ start: 2, end: 5, text: "######" }]);
    expect(document.tree).toEqual(parser.parse(document.source));
    expect(document.tree.children[0]).toMatchObject({
      depth: 6,
      position: { end: { line: 1, column: 21, offset: 20 } },
    });

    document.edit([{ start: 9, end: 14, text: "" }]);
    expect(document.tree).toEqual(parser.parse(document.source));
    expect(document.tree.children[0]).toMatchObject({
      type: "heading",
      depth: 6,
      children: [],
      position: { end: { line: 1, column: 16, offset: 15 } },
    });
    document.edit([{ start: 0, end: 2, text: "" }]);
    expect(document.tree).toEqual(parser.parse(document.source));
  });

  it("moves a top-level list into the preceding list item", () => {
    const document = parser.createDocument("1. a\n\n  \r\n b\n\n   3. c\n");
    document.edit([{ start: 4, end: 7, text: "*" }]);
    expect(document.tree).toEqual(parser.parse(document.source));
    expect(document.tree.children).toHaveLength(1);
    expect(document.tree.children[0]).toMatchObject({
      type: "list",
      ordered: true,
      start: 1,
      children: [{
        type: "listItem",
        spread: true,
        children: [
          { type: "paragraph", children: [{ value: "a*\nb" }] },
          { type: "list", ordered: true, start: 3 },
        ],
      }],
    });
  });

  it("preserves the component label when its body changes", () => {
    const componentParser = createParser({ features: { component: true } });
    const document = componentParser.createDocument("::Card[title]\nbody\n::\n");
    expect(document.tree).toEqual(componentParser.parse(document.source));

    const start = document.source.indexOf("body");
    document.edit([{ start, end: start + 4, text: "first\nsecond" }]);
    expect(document.tree).toEqual(componentParser.parse(document.source));
    expect(document.tree.children[0]).toMatchObject({
      type: "blockComponent",
      children: [
        {
          type: "paragraph",
          children: [{
            type: "text",
            value: "title",
            position: { start: { line: 1, column: 8, offset: 7 } },
          }],
        },
        { type: "paragraph", children: [{ type: "text", value: "first\nsecond" }] },
      ],
    });
  });

  it("includes later paragraphs in a code block when its closing fence is removed", () => {
    const source = "before\n\n```\ncode\n```\n\none\n\ntwo\n\nthree\n";
    const document = parser.createDocument(source);
    const closer = source.lastIndexOf("```");

    document.edit([{ start: closer, end: closer + 3, text: "not" }]);

    expect(document.tree).toEqual(parser.parse(document.source));
  });

  it("keeps parsed fence nodes independent and shifts retained positions once", () => {
    const fenceParser = createParser({ features: { math: true } });
    for (const marker of ["```", "$$"]) {
      const source = `before\n\n${marker}\n  value\n${marker}\n`;
      const first = fenceParser.parse(source);
      const snapshot = structuredClone(first);
      fenceParser.parse(`${marker} other\nchanged\n${marker}`);
      expect(first).toEqual(snapshot);

      const document = fenceParser.createDocument(source);
      const fence = document.tree.children[1];
      document.edit([{ start: 0, end: 0, text: "\n" }]);
      expect(document.tree.children[1]).toBe(fence);
      expect(fence.position?.start.line).toBe(4);
      expect(document.tree).toEqual(fenceParser.parse(document.source));

      const opening = document.source.indexOf(marker);
      document.edit([{ start: opening, end: opening, text: " " }]);
      expect(document.tree).toEqual(fenceParser.parse(document.source));
      expect(document.tree.children[1]).toMatchObject({ value: " value" });
    }
  });

  it("closes an HTML block when its end tag is appended", () => {
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

  it("recognizes frontmatter again when its fence returns to the first line", () => {
    const parser = createParser({ features: { frontmatter: true } });
    const document = parser.createDocument("---\ntitle: example\n---");

    document.edit([{ start: 0, end: 0, text: "\n" }]);
    expect(document.tree.children[0].type).toBe("thematicBreak");
    expect(document.tree).toEqual(parser.parse(document.source));

    document.edit([{ start: 0, end: 1, text: "" }]);
    expect(document.tree.children[0].type).toBe("yaml");
    expect(document.tree).toEqual(parser.parse(document.source));
  });

  it("resolves a forward reference across a code block", () => {
    const source = "[label][x]\n\n    code\n\n[x]: /url";
    const tree = parser.parse(source);
    expect(tree.children).toMatchObject([
      { type: "paragraph", children: [{ type: "linkReference", identifier: "x" }] },
      { type: "code", value: "code" },
      { type: "definition", identifier: "x" },
    ]);
    expect(parser.createDocument(source).tree).toEqual(tree);
  });

  it("resolves an earlier reference when its definition is added", () => {
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

  it("reassociates adjacent references when a definition becomes available", () => {
    const document = parser.createDocument("[foo][bar][baz]\n\n[baz]: /baz\n");
    document.edit([{
      start: document.source.length,
      end: document.source.length,
      text: "\n[bar]: /bar\n",
    }]);

    expect(document.tree).toEqual(parser.parse(document.source));
  });

  it("keeps a reference until its last definition is removed", () => {
    const document = parser.createDocument("[label]\n\nseparator\n\n[label]: /first\n\n[label]: /second\n");
    const referenceBlock = document.tree.children[0];

    const firstColon = document.source.indexOf(":");
    document.edit([{ start: firstColon, end: firstColon + 1, text: "" }]);
    expect(document.tree.children[0]).toBe(referenceBlock);

    const lastColon = document.source.lastIndexOf(":");
    document.edit([{ start: lastColon, end: lastColon + 1, text: "" }]);
    expect(document.tree.children[0]).toMatchObject({
      type: "paragraph",
      children: [{ type: "text", value: "[label]" }],
    });
    expect(document.tree).toEqual(parser.parse(document.source));
  });

  it("keeps direct links and images unchanged when definitions are added", () => {
    const parser = createParser({ features: { component: true, footnote: true, attributes: true } });
    for (const body of ["[label](/direct \"title\")", "![alt](/image)"]) {
      const source = body + "\n\nseparator\n\nlast\n";
      const document = parser.createDocument(source);
      const first = document.tree.children[0];
      document.edit([{ start: source.length, end: source.length, text: "\n[label]: /reference\n[^note]: note\n" }]);
      expect(document.tree).toEqual(parser.parse(document.source));
      expect(document.tree.children[0]).toBe(first);
    }
  });

  it("recognizes a multiline definition when its label is closed", () => {
    const document = parser.createDocument("[a\n# b\nx");
    document.edit([{
      start: document.source.length,
      end: document.source.length,
      text: "]: /u",
    }]);

    expect(document.tree).toEqual(parser.parse(document.source));
    expect(document.tree.children[0]).toMatchObject({ type: "definition", identifier: "a # b x" });
  });

  it("updates a multiline definition title when its closing quote is added", () => {
    const document = parser.createDocument("[a]: /u\n\"title\n# heading\nx");
    document.edit([{
      start: document.source.length,
      end: document.source.length,
      text: "\"",
    }]);

    expect(document.tree).toEqual(parser.parse(document.source));
    expect(document.tree.children[0]).toMatchObject({ type: "definition", title: "title\n# heading\nx" });
  });

  it("updates inline content across separate paragraphs", () => {
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

  it("handles two insertions at the same offset inside a nested block quote", () => {
    const document = parser.createDocument("-1<.  \r\n>> ");
    document.edit([
      { start: 10, end: 10, text: "\n" },
      { start: 10, end: 10, text: "`" },
    ]);

    expect(document.tree).toEqual(parser.parse(document.source));
  });

  it("updates positions inside block quotes and footnotes after edits", () => {
    const parser = createParser({ features: { footnote: true } });
    for (const ending of ["\n", "\r\n", "\r"]) {
      for (const lines of [
        ["> first **one**", ">", "> second **two**", ""],
        ["[^a]: first **one**", "", "    second **two**", ""],
      ]) {
        const document = parser.createDocument(lines.join(ending));
        const container = document.tree.children[0];
        document.edit([{ start: 0, end: 0, text: "lead" + ending + ending }]);
        expect(document.tree.children[1]).toBe(container);
        expect(document.tree).toEqual(parser.parse(document.source));

        const start = document.source.lastIndexOf("second");
        document.edit([{ start, end: start + 6, text: "longer body" }]);
        expect(document.tree).toEqual(parser.parse(document.source));
      }
    }
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

    const boundary = parser.createDocument("\ra");
    boundary.edit([{ start: 1, end: 1, text: "\n" }]);
    expect(boundary.tree).toEqual(parser.parse(boundary.source));
    expect(boundary.tree.children[0].position?.start.line).toBe(2);
  });

  it.each([
    { name: "equal-length content", before: "item", after: "ITEM", omegaLine: 6 },
    { name: "inserted line ending", before: "lazy continuation\r\n", after: "lazy continuation\r\n\n", omegaLine: 7 },
    { name: "shortened line ending", before: "lazy continuation\r\n", after: "lazy continuation\r", omegaLine: 6 },
  ])("keeps later paragraphs positioned correctly after $name edits", ({ before, after, omegaLine }) => {
    const document = parser.createDocument("head\r\n\r\n> - \titem\r\n>   lazy continuation\r\n\r\nomega\r\n\r\ntail\r\n");
    const start = document.source.indexOf(before);
    document.edit([{ start, end: start + before.length, text: after }]);

    const tree = document.tree;
    const omegaOffset = document.source.indexOf("omega");
    const omega = tree.children.find((child) => child.position?.start.offset === omegaOffset);
    expect(tree).toEqual(parser.parse(document.source));
    expect(omega?.position?.start).toEqual({ line: omegaLine, column: 1, offset: omegaOffset });
  });

  it("matches a full parse after each appended chunk", () => {
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
});
