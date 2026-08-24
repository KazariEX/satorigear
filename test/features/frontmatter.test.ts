import { describe, expect, it } from "vitest";
import { createParser } from "../../packages/satorigear/src/index.ts";

const hyphenParser = createParser({ features: { frontmatter: { marker: "-" } } });
const plusParser = createParser({ features: { frontmatter: { marker: "+" } } });
const frontmatterParser = createParser({ features: { frontmatter: true } });

describe("frontmatter", () => {
  it.each([
    {
      parser: hyphenParser,
      source: "---\r\na: b\r\n---\r\n# heading\r\n",
      value: "a: b",
      end: { line: 3, column: 4, offset: 14 },
    },
    {
      parser: plusParser,
      source: "+++\r\na = 'b'\r\n+++\r\n# heading\r\n",
      value: "a = 'b'",
      end: { line: 3, column: 4, offset: 17 },
    },
  ])("parses configured frontmatter %#", ({ parser, source, value, end }) => {
    const tree = parser.parse(source);
    expect(tree.children).toHaveLength(2);
    expect(tree.children[0]).toEqual({
      type: "yaml",
      value,
      position: {
        start: { line: 1, column: 1, offset: 0 },
        end,
      },
    });
    expect(tree.children[1]).toMatchObject({ type: "heading", depth: 1 });
  });

  it.each([
    { fence: "---", parser: hyphenParser },
    { fence: "+++", parser: plusParser },
  ])("accepts empty and whitespace-suffixed $fence fences", ({ fence, parser }) => {
    expect(parser.parse(`${fence} \t\n\n${fence}\t\n`).children[0]).toMatchObject({
      type: "yaml",
      value: "",
    });
  });

  it("uses hyphen fences when enabled without options", () => {
    expect(frontmatterParser.parse("---\ntitle: test\n---\n").children[0]).toMatchObject({
      type: "yaml",
      value: "title: test",
    });
  });

  it.each([
    { source: "---\na: b\n", parser: hyphenParser },
    { source: "+++\na = 'b'\n---\n", parser: plusParser },
    { source: "----\na: b\n----\n", parser: hyphenParser },
    { source: "# heading\n\n---\na: b\n---\n", parser: hyphenParser },
    { source: "> ---\n> a: b\n> ---\n", parser: hyphenParser },
    { source: "---\na: b\n---\n", parser: plusParser },
    { source: "+++\na = 'b'\n+++\n", parser: hyphenParser },
  ])("rejects non-frontmatter form %#", ({ source, parser }) => {
    const tree = parser.parse(source);
    expect(tree.children.some((node) => node.type === "yaml")).toBe(false);
  });

  it("reinterprets the document when an edit closes frontmatter", () => {
    const document = hyphenParser.createDocument("---\ntitle: test\n\n# heading\n");
    document.edit([{
      start: document.source.length,
      end: document.source.length,
      text: "---\n",
    }]);

    expect(document.tree).toEqual(hyphenParser.parse(document.source));
    expect(document.tree.children).toMatchObject([{
      type: "yaml",
      value: "title: test\n\n# heading",
    }]);
  });

  it("does not treat a bounded rescan as the document start", () => {
    const source = "# first\n\n---\na: b\n---\n\nend\n";
    const document = hyphenParser.createDocument(source);
    const start = source.indexOf(":");
    document.edit([{ start, end: start + 1, text: "=" }]);

    expect(document.tree).toEqual(hyphenParser.parse(document.source));
    expect(document.tree.children.some((node) => node.type === "yaml")).toBe(false);
  });

  it("keeps the selected fence fixed across edits", () => {
    const document = hyphenParser.createDocument("---\ntitle: test\n---\nbody\n");
    document.edit([
      { start: 0, end: 3, text: "+++" },
      { start: 16, end: 19, text: "+++" },
    ]);

    expect(document.tree).toEqual(hyphenParser.parse(document.source));
    expect(document.tree.children.some((node) => node.type === "yaml")).toBe(false);
  });
});
