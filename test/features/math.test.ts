import { describe, expect, it } from "vitest";
import { createDocument, parse } from "../../packages/satorigear/src/index.ts";

const options = { math: true } as const;

describe("math", () => {
  it("projects inline math with exact dollar runs", () => {
    expect(parse("before $ a $ and $$b$$ after", options).children[0]).toMatchObject({
      type: "paragraph",
      children: [
        { type: "text", value: "before " },
        { type: "inlineMath", value: "a" },
        { type: "text", value: " and " },
        { type: "inlineMath", value: "b" },
        { type: "text", value: " after" },
      ],
    });

    expect(parse("$$x$y$", options).children[0]).toMatchObject({
      children: [
        { type: "text", value: "$$x" },
        { type: "inlineMath", value: "y" },
      ],
    });
    expect(parse("$x$$y$z$", options).children[0]).toMatchObject({
      children: [
        { type: "inlineMath", value: "x$$y" },
        { type: "text", value: "z$" },
      ],
    });
    expect(parse("$$x$$$", options).children[0]).toMatchObject({
      children: [{ type: "text", value: "$$x$$$" }],
    });
  });

  it("normalizes inline padding while preserving meaningful whitespace", () => {
    expect(parse("$ a $", options).children[0]).toMatchObject({
      children: [{ type: "inlineMath", value: "a" }],
    });
    expect(parse("$  $", options).children[0]).toMatchObject({
      children: [{ type: "inlineMath", value: "  " }],
    });
    expect(parse("$a\nb$", options).children[0]).toMatchObject({
      children: [{ type: "inlineMath", value: "a\nb" }],
    });
    expect(parse("$a\r\nb$", options).children[0]).toMatchObject({
      children: [{ type: "inlineMath", value: "a\r\nb" }],
    });
  });

  it("respects escaped dollars and opaque inline constructs", () => {
    expect(parse("\\$$x$ and `$y$`", options).children[0]).toMatchObject({
      children: [
        { type: "text", value: "$" },
        { type: "inlineMath", value: "x" },
        { type: "text", value: " and " },
        { type: "inlineCode", value: "$y$" },
      ],
    });
    expect(parse("[a $b$](url)", options).children[0]).toMatchObject({
      children: [{
        type: "link",
        children: [
          { type: "text", value: "a " },
          { type: "inlineMath", value: "b" },
        ],
      }],
    });
    expect(parse("$`x$y`$", options).children[0]).toMatchObject({
      children: [
        { type: "inlineMath", value: "`x" },
        { type: "text", value: "y`$" },
      ],
    });
  });

  it("can require double-dollar inline math", () => {
    const strict = { math: { singleDollarTextMath: false } } as const;
    expect(parse("$a$ and $$b$$", strict).children[0]).toMatchObject({
      children: [
        { type: "text", value: "$a$ and " },
        { type: "inlineMath", value: "b" },
      ],
    });
  });

  it("composes with component and attributes transforms", () => {
    expect(parse("[$x$]{.wide}", {
      math: true,
      component: true,
      attributes: true,
    }).children[0]).toMatchObject({
      children: [{
        type: "inlineComponent",
        name: "span",
        attributes: { class: "wide" },
        children: [{ type: "inlineMath", value: "x" }],
      }],
    });
  });

  it("projects fenced math with metadata and indentation", () => {
    const source = "  $$ a&amp;\\*\n  x + y\n  $$$  \n";
    expect(parse(source, options).children[0]).toEqual({
      type: "math",
      meta: "a&*",
      value: "x + y",
      position: {
        start: { line: 1, column: 3, offset: 2 },
        end: { line: 3, column: 8, offset: source.length - 1 },
      },
    });
  });

  it("accepts empty and unclosed math blocks", () => {
    expect(parse("$$\n\n$$\n", options).children[0]).toMatchObject({
      type: "math",
      meta: null,
      value: "",
    });
    expect(parse("$$\nx\n", options).children[0]).toMatchObject({
      type: "math",
      meta: null,
      value: "x",
    });
  });

  it("parses math blocks inside CommonMark containers", () => {
    expect(parse("> $$\n> x\n> $$\n", options).children[0]).toMatchObject({
      type: "blockquote",
      children: [{ type: "math", value: "x" }],
    });
    expect(parse("- $$\n  x\n  $$\n", options).children[0]).toMatchObject({
      type: "list",
      children: [{ children: [{ type: "math", value: "x" }] }],
    });
  });

  it("remains disabled by default", () => {
    for (const source of ["$x$", "$$\nx\n$$\n"]) {
      expect(parse(source).children.some((node) => node.type === "math")).toBe(false);
      expect(JSON.stringify(parse(source))).not.toContain("inlineMath");
    }
  });

  it("keeps full and incremental math parsing equivalent", () => {
    const document = createDocument("value $x$\n\n$$\ny\n$$\n", options);
    document.snapshot();

    const x = document.source.indexOf("x");
    document.edit([{ start: x, end: x + 1, text: "x + 1" }]);
    expect(document.snapshot()).toEqual(parse(document.source, options));

    const closing = document.source.lastIndexOf("$$");
    document.edit([{ start: closing, end: closing + 2, text: "$" }]);
    expect(document.snapshot()).toEqual(parse(document.source, options));
    expect(document.snapshot().children.at(-1)).toMatchObject({ type: "math", value: "y\n$" });
  });
});
