import { describe, expect, it } from "vitest";
import { createParser } from "../../packages/satorigear/src/index.ts";

const parser = createParser({ features: { binding: true } });
const defaultParser = createParser();
const compositeParser = createParser({
  features: {
    attributes: true,
    binding: true,
    component: true,
    table: true,
  },
});

describe("binding", () => {
  it("builds self-closing binding components", () => {
    const source = "Hello {{ user.name }} and {{ data.score || 0 }}!";
    expect(parser.parse(source).children[0]).toEqual({
      type: "paragraph",
      children: [
        {
          type: "text",
          value: "Hello ",
          position: {
            start: { line: 1, column: 1, offset: 0 },
            end: { line: 1, column: 7, offset: 6 },
          },
        },
        {
          type: "inlineComponent",
          name: "binding",
          attributes: { ":value": "user.name" },
          children: [],
          position: {
            start: { line: 1, column: 7, offset: 6 },
            end: { line: 1, column: 22, offset: 21 },
          },
        },
        { type: "text", value: " and ", position: expect.any(Object) },
        {
          type: "inlineComponent",
          name: "binding",
          attributes: { ":value": "data.score", defaultValue: "0" },
          children: [],
          position: {
            start: { line: 1, column: 27, offset: 26 },
            end: { line: 1, column: 48, offset: 47 },
          },
        },
        { type: "text", value: "!", position: expect.any(Object) },
      ],
      position: expect.any(Object),
    });
  });

  it("leaves invalid bindings to ordinary inline parsing", () => {
    for (const source of [
      "x {{  }} y",
      "x {{ unclosed *emphasis*",
      "x {{ || fallback }} y",
      "single { value } here",
    ]) {
      expect(parser.parse(source)).toEqual(defaultParser.parse(source));
    }
    expect(parser.parse("`{{ code }}`").children[0]).toMatchObject({
      children: [{ type: "inlineCode", value: "{{ code }}" }],
    });
  });

  it("composes with links, tables, components, and attributes", () => {
    const source = "::card\n[{{ link.label }}](url)\n\n| [{{ cell }}]{.wide} |\n| --- |\n::\n";
    expect(compositeParser.parse(source).children[0]).toMatchObject({
      type: "blockComponent",
      children: [
        {
          type: "paragraph",
          children: [{
            type: "link",
            children: [{ type: "inlineComponent", name: "binding", attributes: { ":value": "link.label" } }],
          }],
        },
        {
          type: "table",
          children: [{
            children: [{
              children: [{
                type: "inlineComponent",
                name: "span",
                attributes: { class: "wide" },
                children: [{ type: "inlineComponent", name: "binding", attributes: { ":value": "cell" } }],
              }],
            }],
          }],
        },
      ],
    });
  });

  it("keeps full and incremental parsing equivalent", () => {
    const document = parser.createDocument("Hello {{ user.name || Guest }}!\n");

    let start = document.source.indexOf("user.name");
    document.edit([{ start, end: start + 9, text: "account.name" }]);
    expect(document.tree).toEqual(parser.parse(document.source));

    start = document.source.indexOf(" || Guest");
    document.edit([{ start, end: start + 9, text: "" }]);
    expect(document.tree).toEqual(parser.parse(document.source));
    expect(document.tree.children[0]).toMatchObject({
      children: [
        { type: "text", value: "Hello " },
        { type: "inlineComponent", attributes: { ":value": "account.name" } },
        { type: "text", value: "!" },
      ],
    });

    const close = document.source.indexOf("}}");
    document.edit([{ start: close, end: close + 2, text: "" }]);
    expect(document.tree).toEqual(parser.parse(document.source));
    expect(JSON.stringify(document.tree)).not.toContain("inlineComponent");
  });
});
