import { describe, expect, it } from "vitest";
import { createParser } from "../../packages/satorigear/src/index.ts";

const parser = createParser({ features: { taskList: true } });
const compositeParser = createParser({
  features: { strikethrough: true, taskList: true },
});

describe("task list", () => {
  it("builds checked and unchecked GFM task list items", () => {
    const source = "- [ ] foo\n- [x] bar\n- [X] ~~baz~~\n";
    const list = compositeParser.parse(source).children[0];

    expect(list).toMatchObject({
      type: "list",
      ordered: false,
      children: [
        {
          type: "listItem",
          checked: false,
          children: [{
            type: "paragraph",
            children: [{ type: "text", value: "foo" }],
          }],
        },
        {
          type: "listItem",
          checked: true,
          children: [{
            type: "paragraph",
            children: [{ type: "text", value: "bar" }],
          }],
        },
        {
          type: "listItem",
          checked: true,
          children: [{
            type: "paragraph",
            children: [{
              type: "delete",
              children: [{ type: "text", value: "baz" }],
            }],
          }],
        },
      ],
    });
    expect(list.position).toEqual({
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 3, column: 14, offset: source.length - 1 },
    });
    expect(list.type === "list" && list.children[0].children[0]).toMatchObject({
      position: {
        start: { line: 1, column: 7, offset: 6 },
        end: { line: 1, column: 10, offset: 9 },
      },
    });
  });

  it("recognizes ordered, nested, and whitespace task markers", () => {
    const tree = parser.parse(
      "1. [\t] ordered\n" +
      "   - [x] nested\n" +
      "   - [\v] vertical\n" +
      "2. [ ] final\n",
    );

    expect(tree.children[0]).toMatchObject({
      type: "list",
      ordered: true,
      children: [
        {
          checked: false,
          children: [
            { type: "paragraph", children: [{ value: "ordered" }] },
            {
              type: "list",
              children: [
                { checked: true, children: [{ children: [{ value: "nested" }] }] },
                { checked: false, children: [{ children: [{ value: "vertical" }] }] },
              ],
            },
          ],
        },
        { checked: false, children: [{ children: [{ value: "final" }] }] },
      ],
    });
  });

  it("requires a paragraph first block and content after the marker", () => {
    expect(parser.parse(
      "- [x]foo\n" +
      "- [y] foo\n" +
      "- [x] \n" +
      "- [x]\n",
    ).children[0]).toMatchObject({
      type: "list",
      children: [
        { checked: null, children: [{ children: [{ value: "[x]foo" }] }] },
        { checked: null, children: [{ children: [{ value: "[y] foo" }] }] },
        { checked: null, children: [{ children: [{ value: "[x]" }] }] },
        { checked: null, children: [{ children: [{ value: "[x]" }] }] },
      ],
    });

    expect(parser.parse("- [x] heading\n  ---\n").children[0]).toMatchObject({
      type: "list",
      children: [{
        checked: null,
        children: [{ type: "heading", children: [{ value: "[x] heading" }] }],
      }],
    });

    expect(parser.parse("- [ref]: /url\n  [x] task\n").children[0]).toMatchObject({
      type: "list",
      children: [{
        checked: true,
        children: [
          { type: "definition" },
          { type: "paragraph", children: [{ value: "task" }] },
        ],
      }],
    });

    expect(parser.parse("- [x]\n  content\n").children[0]).toMatchObject({
      type: "list",
      children: [{
        checked: true,
        children: [{ type: "paragraph", children: [{ value: "content" }] }],
      }],
    });
  });

  it("keeps full and incremental task list parsing equivalent", () => {
    const document = parser.createDocument("- [ ] todo\n- plain\n");
    const edit = (start: number, end: number, text: string): void => {
      document.edit([{ start, end, text }]);
      expect(document.tree).toEqual(parser.parse(document.source));
    };

    edit(3, 4, "x");
    expect(document.tree.children[0]).toMatchObject({
      type: "list",
      children: [{ checked: true }, { checked: null }],
    });

    edit(5, 6, "");
    expect(document.tree.children[0]).toMatchObject({
      type: "list",
      children: [
        { checked: null, children: [{ children: [{ value: "[x]todo" }] }] },
        { checked: null },
      ],
    });

    const marker = document.source.indexOf("[x]");
    edit(marker, marker + 3, "");
    const plain = document.source.indexOf("plain");
    edit(plain, plain, "[ ] ");
    expect(document.tree.children[0]).toMatchObject({
      type: "list",
      children: [{ checked: null }, { checked: false }],
    });
  });
});
