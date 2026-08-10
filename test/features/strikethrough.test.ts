import { describe, expect, it } from "vitest";
import { createDocument, parse } from "../../packages/satorigear/src/index.ts";

const options = { strikethrough: true } as const;
const strictOptions = { strikethrough: { singleTilde: false } } as const;

describe("strikethrough", () => {
  it("projects GFM delete nodes with nested inline content", () => {
    expect(parse("before ~~**deleted** and [linked](url)~~ after", options).children[0]).toMatchObject({
      type: "paragraph",
      children: [
        { type: "text", value: "before " },
        {
          type: "delete",
          children: [
            { type: "strong", children: [{ type: "text", value: "deleted" }] },
            { type: "text", value: " and " },
            { type: "link", url: "url", children: [{ type: "text", value: "linked" }] },
          ],
        },
        { type: "text", value: " after" },
      ],
    });

    expect(parse("a ~~b~~ c", options).children[0]).toMatchObject({
      children: [{ type: "text", value: "a " }, {
        type: "delete",
        children: [{
          type: "text",
          value: "b",
          position: {
            start: { line: 1, column: 5, offset: 4 },
            end: { line: 1, column: 6, offset: 5 },
          },
        }],
        position: {
          start: { line: 1, column: 3, offset: 2 },
          end: { line: 1, column: 8, offset: 7 },
        },
      }, { type: "text", value: " c" }],
    });

    expect(parse("~~a\nb~~", options).children[0]).toMatchObject({
      children: [{ type: "delete", children: [{ type: "text", value: "a\nb" }] }],
    });
  });

  it("supports GitHub single-tilde syntax", () => {
    expect(parse("a ~b~ c", options).children[0]).toMatchObject({
      children: [
        { type: "text", value: "a " },
        { type: "delete", children: [{ type: "text", value: "b" }] },
        { type: "text", value: " c" },
      ],
    });

    for (const source of ["~~a~", "~a~~", "x ~~~a~~~ y"]) {
      expect(parse(source, options).children[0]).toMatchObject({
        children: [{ type: "text", value: source }],
      });
    }
  });

  it("can require exact double-tilde runs", () => {
    for (const source of ["~a~", "~~a~", "~a~~", "a~~~b~~~c", "~~ a~~", "~~a ~~"]) {
      expect(parse(source, strictOptions).children[0]).toMatchObject({
        children: [{ type: "text", value: source }],
      });
    }
    expect(parse("foo~~bar~~baz", strictOptions).children[0]).toMatchObject({
      children: [
        { type: "text", value: "foo" },
        { type: "delete", children: [{ type: "text", value: "bar" }] },
        { type: "text", value: "baz" },
      ],
    });
  });

  it("remains disabled by default", () => {
    expect(parse("~~text~~")).toEqual(parse("~~text~~", { strikethrough: false }));
    expect(parse("~~text~~").children[0]).toMatchObject({
      children: [{ type: "text", value: "~~text~~" }],
    });
  });

  it("composes with other inline features", () => {
    expect(parse("| ~~[$x$]{.math}~~ |\n| --- |\n", {
      attributes: true,
      component: true,
      math: true,
      strikethrough: true,
      table: true,
    }).children[0]).toMatchObject({
      type: "table",
      children: [{
        children: [{
          children: [{
            type: "delete",
            children: [{
              type: "inlineComponent",
              attributes: { class: "math" },
              children: [{ type: "inlineMath", value: "x" }],
            }],
          }],
        }],
      }],
    });
  });

  it("keeps full and incremental parsing equivalent", () => {
    const document = createDocument("before ~~old~~ after\n", options);
    document.snapshot();

    const value = document.source.indexOf("old");
    document.edit([{ start: value, end: value + 3, text: "**new**" }]);
    expect(document.snapshot()).toEqual(parse(document.source, options));
    expect(document.snapshot().children[0]).toMatchObject({
      children: [{ type: "text" }, { type: "delete", children: [{ type: "strong" }] }, { type: "text" }],
    });

    const close = document.source.lastIndexOf("~~");
    document.edit([{ start: close, end: close + 2, text: "~" }]);
    expect(document.snapshot()).toEqual(parse(document.source, options));
    expect(JSON.stringify(document.snapshot())).not.toContain("\"delete\"");
  });
});
