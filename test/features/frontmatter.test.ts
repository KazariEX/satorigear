import { describe, expect, it } from "vitest";
import { createDocument, parse } from "../../packages/satorigear/src/index.ts";

const hyphen = { frontmatter: { marker: "-" } } as const;
const plus = { frontmatter: { marker: "+" } } as const;

describe("frontmatter", () => {
  it.each([
    {
      options: hyphen,
      source: "---\r\na: b\r\n---\r\n# heading\r\n",
      value: "a: b",
      end: { line: 3, column: 4, offset: 14 },
    },
    {
      options: plus,
      source: "+++\r\na = 'b'\r\n+++\r\n# heading\r\n",
      value: "a = 'b'",
      end: { line: 3, column: 4, offset: 17 },
    },
  ])("parses configured frontmatter %#", ({ options, source, value, end }) => {
    const tree = parse(source, options);
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
    { fence: "---", options: hyphen },
    { fence: "+++", options: plus },
  ])("accepts empty and whitespace-suffixed $fence fences", ({ fence, options }) => {
    expect(parse(`${fence} \t\n\n${fence}\t\n`, options).children[0]).toMatchObject({
      type: "yaml",
      value: "",
    });
  });

  it("does not change default CommonMark parsing", () => {
    const source = "---\na: b\n---\n";
    expect(parse(source).children[0]).toMatchObject({ type: "thematicBreak" });
    expect(parse(source).children.some((node) => node.type === "yaml")).toBe(false);
  });

  it("uses hyphen fences when enabled without options", () => {
    expect(parse("---\ntitle: test\n---\n", { frontmatter: true }).children[0]).toMatchObject({
      type: "yaml",
      value: "title: test",
    });
  });

  it.each([
    { source: "---\na: b\n", options: hyphen },
    { source: "+++\na = 'b'\n---\n", options: plus },
    { source: "----\na: b\n----\n", options: hyphen },
    { source: "# heading\n\n---\na: b\n---\n", options: hyphen },
    { source: "> ---\n> a: b\n> ---\n", options: hyphen },
    { source: "---\na: b\n---\n", options: plus },
    { source: "+++\na = 'b'\n+++\n", options: hyphen },
  ])("rejects non-frontmatter form %#", ({ source, options }) => {
    const tree = parse(source, options);
    expect(tree.children.some((node) => node.type === "yaml")).toBe(false);
  });

  it("restarts from the document head when an edit closes frontmatter", () => {
    const document = createDocument("---\ntitle: test\n\n# heading\n", hyphen);
    document.edit([{
      start: document.source.length,
      end: document.source.length,
      text: "---\n",
    }]);

    expect(document.snapshot()).toEqual(parse(document.source, hyphen));
    expect(document.snapshot().children).toMatchObject([{
      type: "yaml",
      value: "title: test\n\n# heading",
    }]);
  });

  it("keeps the selected fence fixed across edits", () => {
    const document = createDocument("---\ntitle: test\n---\nbody\n", hyphen);
    document.snapshot();
    document.edit([
      { start: 0, end: 3, text: "+++" },
      { start: 16, end: 19, text: "+++" },
    ]);

    expect(document.snapshot()).toEqual(parse(document.source, hyphen));
    expect(document.snapshot().children.some((node) => node.type === "yaml")).toBe(false);
  });
});
