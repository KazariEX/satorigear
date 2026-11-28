import { describe, expect, it } from "vitest";
import { createParser } from "../../packages/satorigear/src/index.ts";

const parser = createParser({ features: { table: true } });

describe("table", () => {
  it("builds aligned GFM tables with inline cell content", () => {
    const source = "| **name** | value\\|unit |\n| :--- | ---: |\n| alpha | `1\\|2` |\n";
    expect(parser.parse(source).children[0]).toEqual({
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
              children: [{ type: "inlineCode", value: "1|2", position: expect.any(Object) }],
              position: expect.any(Object),
            },
          ],
          position: expect.any(Object),
        },
      ],
      position: {
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 3, column: 19, offset: source.length - 1 },
      },
    });
  });

  it("keeps empty cells and trailing delimiter whitespace", () => {
    expect(parser.parse("|  | value |\n| --- | --- |\n").children[0]).toMatchObject({
      type: "table",
      children: [
        {
          children: [
            { type: "tableCell", children: [] },
            { type: "tableCell", children: [{ type: "text", value: "value" }] },
          ],
        },
      ],
    });

    expect(parser.parse("| a |\n| :- |   \n| b |\n").children[0]).toMatchObject({
      type: "table",
      align: ["left"],
      children: [
        { type: "tableRow", children: [{ type: "tableCell" }] },
        { type: "tableRow", children: [{ type: "tableCell" }] },
      ],
    });
  });

  it("keeps variable body widths and stops at block or bare-pipe boundaries", () => {
    expect(parser.parse("a | b\n--- | ---\none\nthree | four | five\n> quote\n").children).toMatchObject([
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

    expect(parser.parse("| a |\n| - |\n|\n").children).toMatchObject([
      {
        type: "table",
        children: [{ type: "tableRow", children: [{ type: "tableCell" }] }],
      },
      { type: "paragraph" },
    ]);
  });

  it("rejects malformed headers and delimiter rows", () => {
    for (const source of [
      "a | b\n: | ---\n",
      "a | b\n--- | :\n",
      "a | b\n| : | --- |\n",
      "a | b\n\t: | ---\n",
      "a | b\n| --- | |\n",
      "a\n|\n",
      "paragraph\n:---\n",
    ]) {
      expect(parser.parse(source).children[0].type).toBe("paragraph");
    }
  });

  it("recognizes tables inside CommonMark containers", () => {
    expect(parser.parse("> a | b\n> --- | ---\n> c | d\n").children[0]).toMatchObject({
      type: "blockquote",
      children: [{ type: "table", children: [{ type: "tableRow" }, { type: "tableRow" }] }],
    });
    expect(parser.parse("- a | b\n  --- | ---\n  c | d\n").children[0]).toMatchObject({
      type: "list",
      children: [{ children: [{ type: "table" }] }],
    });
  });

  it("promotes, splits, and demotes tables across edits", () => {
    const promoted = parser.createDocument("| a | b |\n| === | --- |\n| c | d |\n");
    promoted.edit([{ start: 12, end: 15, text: "---" }]);
    expect(promoted.tree).toEqual(parser.parse(promoted.source));
    expect(promoted.tree.children[0]).toMatchObject({ type: "table" });

    const body = promoted.source.indexOf("| c | d |");
    promoted.edit([{ start: body, end: body + 9, text: "# heading" }]);
    expect(promoted.tree).toEqual(parser.parse(promoted.source));
    expect(promoted.tree.children.map((node) => node.type)).toEqual(["table", "heading"]);

    const demoted = parser.createDocument("a | b\n:-: | ---\n");
    demoted.edit([{ start: 7, end: 9, text: "" }]);
    expect(demoted.tree).toEqual(parser.parse(demoted.source));
    expect(demoted.tree.children[0].type).toBe("paragraph");
  });

  it("preserves table identity and updates cells and positions across edits", () => {
    const fixed = parser.createDocument("| a | b |\n| --- | --- |\n| c | d |\n");
    const cellOffset = fixed.source.indexOf("c");
    fixed.edit([{ start: cellOffset, end: cellOffset + 1, text: "x" }]);
    expect(fixed.tree).toEqual(parser.parse(fixed.source));

    const source = "before\n\n| a | **b** |\n| --- | --- |\n| c | **d** |  \n";
    const document = parser.createDocument(source);
    const table = document.tree.children[1];
    document.edit([{ start: 0, end: 0, text: "\n" }]);
    expect(document.tree.children[1]).toBe(table);
    expect(document.tree).toEqual(parser.parse(document.source));

    const cell = document.source.indexOf("**d**") + 2;
    document.edit([{ start: cell, end: cell + 1, text: "longer" }]);
    expect(document.tree).toEqual(parser.parse(document.source));
    const pipe = document.source.lastIndexOf("|");
    document.edit([{ start: pipe, end: pipe + 1, text: "" }]);
    expect(document.tree).toEqual(parser.parse(document.source));
  });
});
