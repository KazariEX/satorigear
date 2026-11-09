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
