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

  it("keeps variable body widths and stops at another block", () => {
    const source = "a | b\n--- | ---\none\nthree | four | five\n> quote\n";
    const tree = parser.parse(source);
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
    expect(parser.parse("> a | b\n> --- | ---\n> c | d\n").children[0]).toMatchObject({
      type: "blockquote",
      children: [{ type: "table", children: [{ type: "tableRow" }, { type: "tableRow" }] }],
    });
    expect(parser.parse("- a | b\n  --- | ---\n  c | d\n").children[0]).toMatchObject({
      type: "list",
      children: [{ children: [{ type: "table" }] }],
    });
  });

  it("keeps full and incremental table parsing equivalent", () => {
    const document = parser.createDocument("| a | b |\n| === | --- |\n| c | d |\n");
    document.edit([{ start: 12, end: 15, text: "---" }]);
    expect(document.tree).toEqual(parser.parse(document.source));
    expect(document.tree.children[0]).toMatchObject({ type: "table" });

    const body = document.source.indexOf("| c | d |");
    document.edit([{ start: body, end: body + 9, text: "# heading" }]);
    expect(document.tree).toEqual(parser.parse(document.source));
    expect(document.tree.children.map((node) => node.type)).toEqual(["table", "heading"]);
  });

  it("invalidates an unchanged-size cell edit", () => {
    const source = "| a | b |\n| --- | --- |\n| c | d |\n";
    const document = parser.createDocument(source);
    const cell = source.indexOf("c");
    document.edit([{ start: cell, end: cell + 1, text: "x" }]);
    expect(document.tree).toEqual(parser.parse(document.source));
  });

  it("keeps empty cells empty", () => {
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
  });
});
