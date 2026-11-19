import { describe, expect, it } from "vitest";
import { createParser } from "../packages/satorigear/src/index.ts";

const parser = createParser({ features: { attributes: true } });

function parse(source: string) {
  const tree = parser.parse(source);
  expect(parser.createDocument(source).tree).toEqual(tree);
  return tree.children[0];
}

describe("inline text boundaries", () => {
  it("preserves decoded terminal whitespace and its complete source span", () => {
    expect(parse("a&#32;")).toMatchObject({
      children: [{ type: "text", value: "a ", position: { end: { offset: 6, column: 7 } } }],
      position: { end: { offset: 6 } },
    });
  });

  it("keeps unmatched backtick runs literal until a matching run arrives", () => {
    const run = "`".repeat(64);
    for (const escaped of [false, true]) {
      const source = `before ${escaped ? "\\" : ""}${run} tail`;
      const document = parser.createDocument(source);
      expect(document.tree.children[0]).toMatchObject({
        children: [{ type: "text", value: `before ${run} tail` }],
      });
      document.edit([{ start: source.length, end: source.length, text: ` ${run}` }]);
      expect(document.tree).toEqual(parser.parse(document.source));
      if (!escaped) {
        expect(document.tree.children[0]).toMatchObject({
          children: [{ type: "text", value: "before " }, { type: "inlineCode", value: "tail" }],
        });
      }
    }
  });

  it("distinguishes absent and empty link titles during edits", () => {
    const source = "[a](<u v> \"name\" \t)";
    const document = parser.createDocument(source);
    const start = source.indexOf("\"name\"");
    document.edit([{ start, end: start + 6, text: "" }]);
    expect(document.tree).toEqual(parser.parse(document.source));
    expect(document.tree.children[0]).toMatchObject({
      children: [{ type: "link", url: "u v", title: null }],
    });
    document.edit([{ start, end: start, text: "\"\"" }]);
    expect(document.tree).toEqual(parser.parse(document.source));
    expect(document.tree.children[0]).toMatchObject({
      children: [{ type: "link", url: "u v", title: "" }],
    });
  });

  it("keeps multiline pair positions when edits add and remove nested syntax", () => {
    const source = "[first\nsecond](/u)";
    const document = parser.createDocument(source);
    expect(document.tree.children[0]).toMatchObject({
      children: [{
        type: "link",
        children: [{
          type: "text",
          value: "first\nsecond",
          position: { start: { line: 1, column: 2, offset: 1 }, end: { line: 2, column: 7, offset: 13 } },
        }],
        position: { start: { line: 1, column: 1, offset: 0 }, end: { line: 2, column: 12, offset: 18 } },
      }],
    });
    document.edit([{ start: 0, end: 0, text: "prefix\n\n" }]);
    expect(document.tree).toEqual(parser.parse(document.source));
    const start = document.source.indexOf("second");
    document.edit([{ start, end: start + 6, text: "**second**" }]);
    expect(document.tree).toEqual(parser.parse(document.source));
    expect(document.tree.children[1]).toMatchObject({
      children: [{ type: "link", children: [{ type: "text", value: "first\n" }, { type: "strong" }] }],
    });
    document.edit([{ start, end: start + 10, text: "second" }]);
    expect(document.tree).toEqual(parser.parse(document.source));
  });

  it("preserves literal text after reassociated reference closers", () => {
    const source = "[![][`x]`]()]\n\n[`x]:/";
    const document = parser.createDocument(source);
    expect(document.tree).toEqual(parser.parse(source));
    expect(document.tree.children[0]).toMatchObject({
      children: [
        { type: "link", children: [{ type: "imageReference", identifier: "`x" }, { type: "text", value: "`" }] },
        { type: "text", value: "]" },
      ],
    });
    document.edit([{ start: source.length, end: source.length, text: "\n[r]: /unused\n" }]);
    expect(document.tree).toEqual(parser.parse(document.source));
    expect(document.tree.children[0]).toMatchObject({ children: [{ type: "link" }, { type: "text", value: "]" }] });
  });

  it("preserves trailing decoded whitespace inside nested pairs", () => {
    expect(parse("[*x&#32;*](/u)")).toMatchObject({
      children: [{ type: "link", children: [{ type: "emphasis", children: [{ type: "text", value: "x " }] }] }],
    });
  });

  it("keeps terminal block attributes when the last decoded text is whitespace", () => {
    const node = parse("`c`&#32;{#x}");
    expect(node).toMatchObject({
      attributes: { id: "x" },
      children: [{ type: "inlineCode", value: "c" }, { type: "text", value: " " }],
    });
    expect("children" in node && node.children).toHaveLength(2);
  });

  it("retains decorated decoded whitespace before a soft break", () => {
    expect(parse("&#32;{#x}\nnext")).toMatchObject({
      children: [
        { type: "text", value: " ", attributes: { id: "x" } },
        { type: "text", value: "\nnext" },
      ],
    });
  });

  it("keeps text after an attributed node separate", () => {
    expect(parse("a{#x} b&#32;")).toMatchObject({
      children: [{ type: "text", value: "a", attributes: { id: "x" } }, { type: "text", value: " b " }],
    });
  });

  it("restores whitespace when a later edit makes it internal text", () => {
    const source = "x&#32;";
    const document = parser.createDocument(source);
    document.edit([{ start: source.length, end: source.length, text: "z" }]);
    expect(document.tree).toEqual(parser.parse(document.source));
    expect(document.tree.children[0]).toMatchObject({ children: [{ type: "text", value: "x z" }] });
    document.edit([{ start: source.length, end: source.length + 1, text: "" }]);
    expect(document.tree).toEqual(parser.parse(source));
  });
});
