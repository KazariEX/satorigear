import { describe, expect, it } from "vitest";
import * as inlineRuntime from "../packages/satorigear/src/generated/inline.ts";
import { reassociateMarkdownReferenceTails } from "../packages/satorigear/src/grammar-inline.ts";
import { parse } from "../packages/satorigear/src/index.ts";

describe("markdown mdast conversion", () => {
  it("preserves mdast definitions and references", () => {
    expect(parse("[label][id]\n\n[id]: /url \"title\"\n")).toMatchObject({
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

  it("preserves unchanged inline tokens while reassociating overlapping references", () => {
    const plainSource = "plain *text*";
    const plainTokens = inlineRuntime.tokenize(plainSource);
    expect(reassociateMarkdownReferenceTails(plainSource, plainTokens, new Set())).toBe(plainTokens);

    expect(parse("[foo][bar][baz]\n\n[baz]: /url\n").children[0]).toMatchObject({
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
    const links = parse([
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

    expect(parse("``` &copy;\nx\n```\n").children[0]).toMatchObject({ lang: "©" });
    expect(parse("``` &#87654321;\nx\n```\n").children[0]).toMatchObject({ lang: "&#87654321;" });
  });

  it("maps source offsets to mdast positions", () => {
    const tree = parse("  foo  \nbar\n");
    expect(tree.position).toEqual({
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 3, column: 1, offset: 12 },
    });
    expect(tree.children[0].position).toEqual({
      start: { line: 1, column: 3, offset: 2 },
      end: { line: 2, column: 4, offset: 11 },
    });
  });

  it("maps soft line endings across stripped block quote prefixes", () => {
    const tree = parse("> one\n> two\n");
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
    const tree = parse("> a *b\n> c* d\n");
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
    const tree = parse("> a  \n> b\n");
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

  it("uses original delimiter run lengths for the rule of three", () => {
    const tree = parse("*****b___(__\n___**_.****(__*****\n");
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
