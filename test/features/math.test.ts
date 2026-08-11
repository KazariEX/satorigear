import { describe, expect, it } from "vitest";
import { createParser } from "../../packages/satorigear/src/index.ts";

const options = { math: true } as const;
const parser = createParser(options);
const strictParser = createParser({ math: { singleDollarTextMath: false } });
const componentParser = createParser({
  attributes: true,
  component: true,
  math: true,
});
const defaultParser = createParser();

describe("math", () => {
  it("builds inline math with exact dollar runs", () => {
    expect(parser.parse("before $ a $ and $$b$$ after").children[0]).toMatchObject({
      type: "paragraph",
      children: [
        { type: "text", value: "before " },
        { type: "inlineMath", value: "a" },
        { type: "text", value: " and " },
        { type: "inlineMath", value: "b" },
        { type: "text", value: " after" },
      ],
    });

    expect(parser.parse("$$x$y$").children[0]).toMatchObject({
      children: [
        { type: "text", value: "$$x" },
        { type: "inlineMath", value: "y" },
      ],
    });
    expect(parser.parse("$x$$y$z$").children[0]).toMatchObject({
      children: [
        { type: "inlineMath", value: "x$$y" },
        { type: "text", value: "z$" },
      ],
    });
    expect(parser.parse("$$x$$$").children[0]).toMatchObject({
      children: [{ type: "text", value: "$$x$$$" }],
    });
  });

  it("normalizes inline padding while preserving meaningful whitespace", () => {
    expect(parser.parse("$ a $").children[0]).toMatchObject({
      children: [{ type: "inlineMath", value: "a" }],
    });
    expect(parser.parse("$  $").children[0]).toMatchObject({
      children: [{ type: "inlineMath", value: "  " }],
    });
    expect(parser.parse("$a\nb$").children[0]).toMatchObject({
      children: [{ type: "inlineMath", value: "a\nb" }],
    });
    expect(parser.parse("$a\r\nb$").children[0]).toMatchObject({
      children: [{ type: "inlineMath", value: "a\r\nb" }],
    });
  });

  it("respects escaped dollars and opaque inline constructs", () => {
    expect(parser.parse("\\$$x$ and `$y$`").children[0]).toMatchObject({
      children: [
        { type: "text", value: "$" },
        { type: "inlineMath", value: "x" },
        { type: "text", value: " and " },
        { type: "inlineCode", value: "$y$" },
      ],
    });
    expect(parser.parse("[a $b$](url)").children[0]).toMatchObject({
      children: [{
        type: "link",
        children: [
          { type: "text", value: "a " },
          { type: "inlineMath", value: "b" },
        ],
      }],
    });
    expect(parser.parse("$`x$y`$").children[0]).toMatchObject({
      children: [
        { type: "inlineMath", value: "`x" },
        { type: "text", value: "y`$" },
      ],
    });
  });

  it("can require double-dollar inline math", () => {
    expect(strictParser.parse("$a$ and $$b$$").children[0]).toMatchObject({
      children: [
        { type: "text", value: "$a$ and " },
        { type: "inlineMath", value: "b" },
      ],
    });
  });

  it("composes with component and attributes transforms", () => {
    expect(componentParser.parse("[$x$]{.wide}").children[0]).toMatchObject({
      children: [{
        type: "inlineComponent",
        name: "span",
        attributes: { class: "wide" },
        children: [{ type: "inlineMath", value: "x" }],
      }],
    });
  });

  it("builds fenced math with metadata and indentation", () => {
    const source = "  $$ a&amp;\\*\n  x + y\n  $$$  \n";
    expect(parser.parse(source).children[0]).toEqual({
      type: "math",
      meta: "a&*",
      value: "x + y",
      position: {
        start: { line: 1, column: 3, offset: 2 },
        end: { line: 3, column: 8, offset: source.length - 1 },
      },
    });
  });

  it.each(["\n", "\r", "\r\n"])("preserves %j math block line endings", (ending) => {
    const source = `$$${ending}x${ending}y${ending}$$${ending}`;
    expect(parser.parse(source).children[0]).toMatchObject({
      type: "math",
      value: `x${ending}y`,
    });
  });

  it("accepts empty and unclosed math blocks", () => {
    expect(parser.parse("$$\n\n$$\n").children[0]).toMatchObject({
      type: "math",
      meta: null,
      value: "",
    });
    expect(parser.parse("$$\nx\n").children[0]).toMatchObject({
      type: "math",
      meta: null,
      value: "x",
    });
  });

  it("parses math blocks inside CommonMark containers", () => {
    expect(parser.parse("> $$\n> x\n> $$\n").children[0]).toMatchObject({
      type: "blockquote",
      children: [{ type: "math", value: "x" }],
    });
    expect(parser.parse("- $$\n  x\n  $$\n").children[0]).toMatchObject({
      type: "list",
      children: [{ children: [{ type: "math", value: "x" }] }],
    });
  });

  it("remains disabled by default", () => {
    for (const source of ["$x$", "$$\nx\n$$\n"]) {
      expect(defaultParser.parse(source).children.some((node) => node.type === "math")).toBe(false);
      expect(JSON.stringify(defaultParser.parse(source))).not.toContain("inlineMath");
    }
  });

  it("keeps full and incremental math parsing equivalent", () => {
    const document = parser.createDocument("value $x$\n\n$$\ny\n$$\n");
    document.snapshot();

    const x = document.source.indexOf("x");
    document.edit([{ start: x, end: x + 1, text: "x + 1" }]);
    expect(document.snapshot()).toEqual(parser.parse(document.source));

    const closing = document.source.lastIndexOf("$$");
    document.edit([{ start: closing, end: closing + 2, text: "$" }]);
    expect(document.snapshot()).toEqual(parser.parse(document.source));
    expect(document.snapshot().children.at(-1)).toMatchObject({ type: "math", value: "y\n$" });
  });
});
