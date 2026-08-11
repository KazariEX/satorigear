import { describe, expect, it } from "vitest";
import { createParser } from "../../packages/satorigear/src/index.ts";

const parser = createParser({ footnote: true });
const componentParser = createParser({ component: true, footnote: true });
const defaultParser = createParser();
const disabledParser = createParser({ footnote: false });

describe("footnote", () => {
  it("builds references and definitions as mdast associations", () => {
    const source = "A note[^alpha].\n\n[^alpha]: **bold** note.\n";
    expect(parser.parse(source).children).toMatchObject([
      {
        type: "paragraph",
        children: [
          { type: "text", value: "A note" },
          {
            type: "footnoteReference",
            identifier: "alpha",
            label: "alpha",
            position: {
              start: { line: 1, column: 7, offset: 6 },
              end: { line: 1, column: 15, offset: 14 },
            },
          },
          { type: "text", value: "." },
        ],
      },
      {
        type: "footnoteDefinition",
        identifier: "alpha",
        label: "alpha",
        children: [{
          type: "paragraph",
          children: [
            { type: "strong", children: [{ type: "text", value: "bold" }] },
            { type: "text", value: " note." },
          ],
        }],
      },
    ]);
  });

  it("activates only calls backed by a definition", () => {
    expect(parser.parse("known[^a] unknown[^b]\n\n[^a]: note\n").children[0]).toMatchObject({
      children: [
        { type: "text", value: "known" },
        { type: "footnoteReference", identifier: "a" },
        { type: "text", value: " unknown[^b]" },
      ],
    });
  });

  it("keeps link and footnote definitions in separate namespaces", () => {
    const source = "[link][same] note[^same]\n\n[same]: /url\n\n[^same]: note\n";
    expect(parser.parse(source).children[0]).toMatchObject({
      children: [
        { type: "linkReference", identifier: "same" },
        { type: "text", value: " note" },
        { type: "footnoteReference", identifier: "same" },
      ],
    });
  });

  it("rejects empty, whitespace, and overlong labels", () => {
    const long = "a".repeat(1000);
    const source = [
      "empty[^] spaced[^ a] escaped[^a\\ b] long[^" + long + "]",
      "",
      "[^]: empty",
      "[^ a]: spaced",
      "[^a\\ b]: escaped",
      "[^" + long + "]: long",
      "",
    ].join("\n");
    expect(JSON.stringify(parser.parse(source))).not.toContain("footnote");
  });

  it("follows the footnote precedence of links and images", () => {
    const source = [
      "![^a] [inside [^a]](url) ![^a](image)",
      "",
      "[^a]: note",
      "",
    ].join("\n");
    expect(parser.parse(source).children[0]).toMatchObject({
      children: [
        { type: "text", value: "!" },
        { type: "footnoteReference", identifier: "a" },
        { type: "text", value: " " },
        {
          type: "link",
          children: [
            { type: "text", value: "inside " },
            { type: "footnoteReference", identifier: "a" },
          ],
        },
        { type: "text", value: " " },
        { type: "image", alt: "^a", url: "image" },
      ],
    });
  });

  it("separates adjacent calls from full reference tails", () => {
    const source = "[^a][^b] [text][^b]\n\n[^a]: first\n\n[^b]: second\n";
    expect(parser.parse(source).children[0]).toMatchObject({
      children: [
        { type: "footnoteReference", identifier: "a" },
        { type: "footnoteReference", identifier: "b" },
        { type: "text", value: " [text]" },
        { type: "footnoteReference", identifier: "b" },
      ],
    });
  });

  it("supports empty and interrupting definitions in containers", () => {
    const source = [
      "- paragraph",
      "  [^a]: note",
      "",
      "[^empty]:",
      "",
    ].join("\n");
    expect(parser.parse(source).children).toMatchObject([
      {
        type: "list",
        children: [{
          children: [
            { type: "paragraph", children: [{ type: "text", value: "paragraph" }] },
            { type: "footnoteDefinition", identifier: "a" },
          ],
        }],
      },
      { type: "footnoteDefinition", identifier: "empty", children: [] },
    ]);
  });

  it("normalizes source labels while decoding their displayed value", () => {
    const source = "call[^A\\+B]\n\n[^a\\+b]: note\n";
    expect(parser.parse(source).children).toMatchObject([
      {
        children: [
          { type: "text", value: "call" },
          { type: "footnoteReference", identifier: "a\\+b", label: "A+B" },
        ],
      },
      { type: "footnoteDefinition", identifier: "a\\+b", label: "a+b" },
    ]);
  });

  it("parses lazy lines and indented blocks inside definitions", () => {
    const source = [
      "call[^long]",
      "",
      "[^long]: first",
      "lazy",
      "",
      "    second",
      "",
      "    > quote",
      "",
    ].join("\n");
    expect(parser.parse(source).children[1]).toMatchObject({
      type: "footnoteDefinition",
      children: [
        { type: "paragraph", children: [{ type: "text", value: "first\nlazy" }] },
        { type: "paragraph", children: [{ type: "text", value: "second" }] },
        { type: "blockquote", children: [{ type: "paragraph" }] },
      ],
    });
  });

  it("composes with CommonMark containers", () => {
    const source = "> call[^q]\n>\n> [^q]: inside\n> continuation\n";
    expect(parser.parse(source).children[0]).toMatchObject({
      type: "blockquote",
      children: [
        { type: "paragraph", children: [{ type: "text" }, { type: "footnoteReference" }] },
        {
          type: "footnoteDefinition",
          children: [{ type: "paragraph", children: [{ type: "text", value: "inside\ncontinuation" }] }],
        },
      ],
    });
  });

  it("composes with other built-in inline carriers", () => {
    const source = "before :Card[note[^a]]\n\n[^a]: inside\n";
    expect(componentParser.parse(source).children[0]).toMatchObject({
      children: [
        { type: "text", value: "before " },
        {
          type: "inlineComponent",
          name: "card",
          children: [
            { type: "text", value: "note" },
            { type: "footnoteReference", identifier: "a" },
          ],
        },
      ],
    });
  });

  it("remains disabled by default", () => {
    const source = "call[^a]\n\n[^a]: note\n";
    expect(defaultParser.parse(source)).toEqual(disabledParser.parse(source));
    expect(JSON.stringify(defaultParser.parse(source))).not.toContain("footnote");
  });

  it("keeps full and incremental parsing equivalent as definitions change", () => {
    const document = parser.createDocument("call[^a]\n");
    document.snapshot();

    document.edit([{
      start: document.source.length,
      end: document.source.length,
      text: "\n[^a]: old\n",
    }]);
    expect(document.snapshot()).toEqual(parser.parse(document.source));
    expect(document.snapshot().children[0]).toMatchObject({
      children: [{ type: "text", value: "call" }, { type: "footnoteReference" }],
    });

    const label = document.source.lastIndexOf("a");
    document.edit([{ start: label, end: label + 1, text: "b" }]);
    expect(document.snapshot()).toEqual(parser.parse(document.source));
    expect(JSON.stringify(document.snapshot().children[0])).not.toContain("footnoteReference");

    const call = document.source.indexOf("[^a]") + 2;
    document.edit([{ start: call, end: call + 1, text: "b" }]);
    expect(document.snapshot()).toEqual(parser.parse(document.source));
    expect(document.snapshot().children[0]).toMatchObject({
      children: [{ type: "text", value: "call" }, { type: "footnoteReference" }],
    });

    const colon = document.source.lastIndexOf(":");
    document.edit([{ start: colon, end: colon + 1, text: "" }]);
    expect(document.snapshot()).toEqual(parser.parse(document.source));
    expect(JSON.stringify(document.snapshot())).not.toContain("footnoteReference");

    const markerEnd = document.source.lastIndexOf("]") + 1;
    document.edit([{ start: markerEnd, end: markerEnd, text: ":" }]);
    expect(document.snapshot()).toEqual(parser.parse(document.source));
    expect(JSON.stringify(document.snapshot())).toContain("footnoteReference");
  });
});
