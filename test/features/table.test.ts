import { describe, expect, it } from "vitest";
import { createDocument, parse } from "../../packages/satorigear/src/index.ts";

const options = { table: true } as const;

describe("table", () => {
  it("projects aligned GFM tables with inline cell content", () => {
    const source = "| **name** | value\\|unit |\n| :--- | ---: |\n| alpha | `1` |\n";
    expect(parse(source, options).children[0]).toEqual({
      type: "table",
      align: ["left", "right"],
      children: [
        {
          type: "tableRow",
          children: [
            {
              type: "tableCell",
              children: [{
                type: "strong",
                children: [{ type: "text", value: "name", position: expect.any(Object) }],
                position: expect.any(Object),
              }],
              position: {
                start: { line: 1, column: 1, offset: 0 },
                end: { line: 1, column: 12, offset: 11 },
              },
            },
            {
              type: "tableCell",
              children: [{ type: "text", value: "value|unit", position: expect.any(Object) }],
              position: {
                start: { line: 1, column: 12, offset: 11 },
                end: { line: 1, column: 27, offset: 26 },
              },
            },
          ],
          position: {
            start: { line: 1, column: 1, offset: 0 },
            end: { line: 1, column: 27, offset: 26 },
          },
        },
        {
          type: "tableRow",
          children: [
            {
              type: "tableCell",
              children: [{ type: "text", value: "alpha", position: expect.any(Object) }],
              position: expect.any(Object),
            },
            {
              type: "tableCell",
              children: [{ type: "inlineCode", value: "1", position: expect.any(Object) }],
              position: expect.any(Object),
            },
          ],
          position: expect.any(Object),
        },
      ],
      position: {
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 3, column: 16, offset: source.length - 1 },
      },
    });
  });

  it("keeps variable body widths and stops at another block", () => {
    const source = "a | b\n--- | ---\none\nthree | four | five\n> quote\n";
    const tree = parse(source, options);
    expect(tree.children).toMatchObject([
      {
        type: "table",
        align: [null, null],
        children: [
          { type: "tableRow", children: [{ type: "tableCell" }, { type: "tableCell" }] },
          { type: "tableRow", children: [{ type: "tableCell" }] },
          {
            type: "tableRow",
            children: [{ type: "tableCell" }, { type: "tableCell" }, { type: "tableCell" }],
          },
        ],
      },
      { type: "blockquote" },
    ]);
  });

  it("recognizes tables inside CommonMark containers", () => {
    expect(parse("> a | b\n> --- | ---\n> c | d\n", options).children[0]).toMatchObject({
      type: "blockquote",
      children: [{ type: "table", children: [{ type: "tableRow" }, { type: "tableRow" }] }],
    });
    expect(parse("- a | b\n  --- | ---\n  c | d\n", options).children[0]).toMatchObject({
      type: "list",
      children: [{ children: [{ type: "table" }] }],
    });
  });

  it("preserves CommonMark precedence and remains disabled by default", () => {
    const source = "| a | b |\n| --- | --- |\n";
    expect(parse(source).children[0]).toMatchObject({ type: "paragraph" });
    expect(parse("| a | b |\n| --- |\n", options).children[0]).toMatchObject({ type: "paragraph" });
    expect(parse("a | b\n- | -\n", options).children.map((node) => node.type)).toEqual([
      "paragraph",
      "list",
    ]);
    expect(parse("| a |\n---\n", options).children[0]).toMatchObject({ type: "heading", depth: 2 });
  });

  it("keeps full and incremental table parsing equivalent", () => {
    const document = createDocument("| a | b |\n| === | --- |\n| c | d |\n", options);
    document.edit([{ start: 12, end: 15, text: "---" }]);
    expect(document.snapshot()).toEqual(parse(document.source, options));
    expect(document.snapshot().children[0]).toMatchObject({ type: "table" });

    const body = document.source.indexOf("| c | d |");
    document.edit([{ start: body, end: body + 9, text: "# heading" }]);
    expect(document.snapshot()).toEqual(parse(document.source, options));
    expect(document.snapshot().children.map((node) => node.type)).toEqual(["table", "heading"]);
  });
});
