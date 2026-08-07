import { describe, expect, it } from "vitest";
import { markdownCstToMdast, markdownToMdast } from "../packages/satorigear/src/index.ts";

describe("markdown mdast conversion", () => {
  it("preserves mdast definitions and references", () => {
    expect(markdownToMdast("[label][id]\n\n[id]: /url \"title\"\n")).toMatchObject({
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

  it("decodes only valid CommonMark character references", () => {
    const links = markdownToMdast([
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

    expect(markdownToMdast("``` &copy;\nx\n```\n").children[0]).toMatchObject({ lang: "©" });
    expect(markdownToMdast("``` &#87654321;\nx\n```\n").children[0]).toMatchObject({ lang: "&#87654321;" });
  });

  it("maps CST offsets to mdast positions", () => {
    const tree = markdownToMdast("  foo  \nbar\n");
    expect(tree.position).toEqual({
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 3, column: 1, offset: 12 },
    });
    expect(tree.children[0].position).toEqual({
      start: { line: 1, column: 3, offset: 2 },
      end: { line: 2, column: 4, offset: 11 },
    });
  });

  it("rejects a non-document CST root", () => {
    expect(() => markdownCstToMdast({ rule: "Paragraph", children: [], offset: 0, end: 0 }, ""))
      .toThrow("Expected Markdown Document CST");
  });

  it("fails loudly when the phased CST contract changes", () => {
    expect(() => markdownCstToMdast({
      rule: "Document",
      offset: 0,
      end: 0,
      children: [{
        rule: "Block",
        offset: 0,
        end: 0,
        children: [{ rule: "UnknownBlock", offset: 0, end: 0, children: [] }],
      }],
    }, "")).toThrow("Unexpected block CST rule: UnknownBlock");
  });
});
