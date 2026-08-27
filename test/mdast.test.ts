import { describe, expect, it } from "vitest";
import { createParser } from "../packages/satorigear/src/index.ts";

const parser = createParser();

describe("markdown mdast conversion", () => {
  it("preserves mdast definitions and references", () => {
    expect(parser.parse("[label][id]\n\n[id]: /url \"title\"\n")).toMatchObject({
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [{
            type: "linkReference",
            children: [{ type: "text", value: "label" }],
            identifier: "id",
            label: "id",
            referenceType: "full",
          }],
        },
        {
          type: "definition",
          identifier: "id",
          label: "id",
          title: "title",
          url: "/url",
        },
      ],
    });
  });

  it("reassociates overlapping references", () => {
    expect(parser.parse("[foo][bar][baz]\n\n[baz]: /url\n").children[0]).toMatchObject({
      type: "paragraph",
      children: [
        { type: "text", value: "[foo]" },
        {
          type: "linkReference",
          children: [{ type: "text", value: "bar" }],
          identifier: "baz",
          label: "baz",
          referenceType: "full",
        },
      ],
    });
  });

  it("decodes only valid CommonMark character references", () => {
    const links = parser.parse([
      "[valid](&ouml; \"&#35;\")",
      "",
      "[escaped](\\&amp; \"\\&copy;\")",
      "",
      "[oversized](&#87654321; \"&#xabcdef0;\")",
      "",
    ].join("\n"));
    expect(links.children).toMatchObject([
      { children: [{ type: "link", url: "ö", title: "#" }] },
      { children: [{ type: "link", url: "&amp;", title: "&copy;" }] },
      { children: [{ type: "link", url: "&#87654321;", title: "&#xabcdef0;" }] },
    ]);

    expect(parser.parse("``` &copy;\nx\n```\n").children[0]).toMatchObject({ lang: "©" });
    expect(parser.parse("``` &#87654321;\nx\n```\n").children[0]).toMatchObject({ lang: "&#87654321;" });
  });

  it("does not treat decoded line feeds as syntax newlines", () => {
    expect(parser.parse("a &#10;b").children[0]).toMatchObject({
      children: [{ type: "text", value: "a \nb" }],
    });
  });

  it("maps source offsets to mdast positions", () => {
    const tree = parser.parse("  foo  \nbar\n");
    expect(tree.position).toEqual({
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 3, column: 1, offset: 12 },
    });
    expect(tree.children[0].position).toEqual({
      start: { line: 1, column: 3, offset: 2 },
      end: { line: 2, column: 4, offset: 11 },
    });
  });

  it("recognizes the bounded ordered-list marker forms", () => {
    expect(parser.parse("123456789. item\n").children[0]).toMatchObject({
      type: "list",
      ordered: true,
      start: 123456789,
    });
    expect(parser.parse("1)\titem\n").children[0]).toMatchObject({
      type: "list",
      ordered: true,
      start: 1,
    });
    expect(parser.parse("1234567890. item\n").children[0]).toMatchObject({ type: "paragraph" });
  });

  it.each(["\n", "\r", "\r\n"])("detects list spread across %j line endings", (ending) => {
    expect(parser.parse(`- first${ending}${ending}- second${ending}`).children[0]).toMatchObject({
      type: "list",
      spread: true,
    });
  });

  it.each([
    { name: "nested quote blanks", source: "* a\n  > b\n  >\n  c\n", spread: false },
    { name: "indented code trailing blanks", source: "-     code\n\n  para\n", spread: true },
  ])("attributes $name to the direct list container", ({ source, spread }) => {
    expect(parser.parse(source).children[0]).toMatchObject({
      type: "list",
      children: [{ spread }],
    });
  });

  it("updates list-item spread when an edit adds or removes blank separation", () => {
    const document = parser.createDocument("- a\n  b\n");
    document.edit([{ start: 4, end: 4, text: "\n" }]);
    expect(document.tree).toEqual(parser.parse(document.source));
    expect(document.tree.children[0]).toMatchObject({ children: [{ spread: true }] });

    document.edit([{ start: 4, end: 5, text: "" }]);
    expect(document.tree).toEqual(parser.parse(document.source));
    expect(document.tree.children[0]).toMatchObject({ children: [{ spread: false }] });
  });

  it("maps soft line endings across stripped block quote prefixes", () => {
    const tree = parser.parse("> one\n> two\n");
    expect(tree.children[0]).toMatchObject({
      type: "blockquote",
      children: [{
        type: "paragraph",
        children: [{
          type: "text",
          value: "one\ntwo",
          position: {
            start: { line: 1, column: 3, offset: 2 },
            end: { line: 2, column: 6, offset: 11 },
          },
        }],
      }],
    });
  });

  it("keeps stripped block quote prefixes out of inline containers", () => {
    const tree = parser.parse("> a *b\n> c* d\n");
    expect(tree.children[0]).toMatchObject({
      type: "blockquote",
      children: [{
        type: "paragraph",
        children: [
          { type: "text", value: "a " },
          {
            type: "emphasis",
            children: [{
              type: "text",
              value: "b\nc",
              position: {
                start: { line: 1, column: 6, offset: 5 },
                end: { line: 2, column: 4, offset: 10 },
              },
            }],
          },
          { type: "text", value: " d" },
        ],
      }],
    });
  });

  it("extends hard breaks across stripped block quote prefixes", () => {
    const tree = parser.parse("> a  \n> b\n");
    expect(tree.children[0]).toMatchObject({
      type: "blockquote",
      children: [{
        type: "paragraph",
        children: [
          { type: "text", value: "a" },
          {
            type: "break",
            position: {
              start: { line: 1, column: 4, offset: 3 },
              end: { line: 2, column: 1, offset: 6 },
            },
          },
          { type: "text", value: "b" },
        ],
      }],
    });
  });

  it.each([
    { name: "LF", ending: "\n", breakEnd: 7 },
    { name: "CR", ending: "\r", breakEnd: 7 },
    { name: "CRLF", ending: "\r\n", breakEnd: 9 },
  ])("maps $name line boundaries at the document edges", ({ ending, breakEnd }) => {
    const source = `${ending}> a  ${ending}> b${ending}`;
    const tree = parser.parse(source);
    const quote = tree.children[0];
    if (quote?.type !== "blockquote") {
      throw new Error("Expected a block quote");
    }
    const paragraph = quote.children[0];
    if (paragraph?.type !== "paragraph") {
      throw new Error("Expected a paragraph");
    }

    expect(tree.position).toMatchObject({ start: { offset: 0 }, end: { offset: source.length } });
    expect(paragraph.children[1]).toMatchObject({
      type: "break",
      position: { end: { line: 3, column: 1, offset: breakEnd } },
    });
  });

  it("uses original delimiter run lengths for the rule of three", () => {
    const tree = parser.parse("*****b___(__\n___**_.****(__*****\n");
    expect(tree.children).toMatchObject([{
      type: "paragraph",
      children: [
        {
          type: "emphasis",
          children: [{
            type: "strong",
            children: [
              {
                type: "strong",
                children: [{ type: "text", value: "b___(__\n___" }],
              },
              { type: "text", value: "_.****(__" },
            ],
          }],
        },
        { type: "text", value: "**" },
      ],
    }]);
  });
});
