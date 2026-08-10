import { describe, expect, expectTypeOf, it } from "vitest";
import type { Root } from "mdast";
import {
  createDocument,
  type Document,
  parse,
} from "../../packages/satorigear/src/index.ts";

const options = { attributes: true } as const;

describe("attributes", () => {
  it("does not create span wrappers without component syntax", () => {
    expect(parse("[span]{.mark}\n", options).children[0]).toMatchObject({
      type: "paragraph",
      attributes: { class: "mark" },
      children: [{ type: "text", value: "[span]" }],
    });
    expect(parse("[plain]\n", options)).toEqual(parse("[plain]\n"));
  });

  it("attaches attributes to structured inline nodes", () => {
    expect(parse("**strong**{.bold} [link](url){target=_blank} `code`{lang=ts}\n", options).children[0])
      .toMatchObject({
        type: "paragraph",
        children: [
          { type: "strong", attributes: { class: "bold" } },
          { type: "text", value: " " },
          { type: "link", attributes: { target: "_blank" } },
          { type: "text", value: " " },
          { type: "inlineCode", attributes: { lang: "ts" } },
        ],
      });
  });

  it("keeps attributed text separate from following text", () => {
    expect(parse("word{.mark}{.bright} tail **bold**\n", options).children[0]).toMatchObject({
      type: "paragraph",
      children: [
        { type: "text", value: "word", attributes: { class: "mark bright" } },
        { type: "text", value: " tail " },
        { type: "strong" },
      ],
    });
  });

  it("promotes terminal text attributes to their block owner", () => {
    const tree = parse("paragraph{.lead}\n\n# heading{#title}\n\n- item{.compact}\n", options);
    expect(tree.children).toMatchObject([
      {
        type: "paragraph",
        attributes: { class: "lead" },
        children: [{ type: "text", value: "paragraph" }],
      },
      {
        type: "heading",
        attributes: { id: "title" },
        children: [{ type: "text", value: "heading" }],
      },
      {
        type: "list",
        children: [{
          type: "listItem",
          attributes: { class: "compact" },
          children: [{ type: "paragraph", children: [{ type: "text", value: "item" }] }],
        }],
      },
    ]);
  });

  it("keeps terminal attributes on paragraphs in loose list items", () => {
    expect(parse("- first{.lead}\n\n  second\n", options).children[0]).toMatchObject({
      type: "list",
      children: [{
        type: "listItem",
        children: [
          { type: "paragraph", attributes: { class: "lead" } },
          { type: "paragraph" },
        ],
      }],
    });
  });

  it("does not consume mustaches, templates or leading attribute bags", () => {
    const source = ["{{ value }} ", "$", "{value}", "\n\n{value={nested}}\n"].join("");
    expect(parse(source, options)).toEqual(parse(source));
  });

  it("composes native attributes with component syntax", () => {
    const tree = parse(":Badge[**label**{.label}]{tone=info} **text**{.bold}\n", {
      attributes: true,
      component: true,
    });
    expect(tree.children[0]).toMatchObject({
      type: "paragraph",
      children: [
        {
          type: "inlineComponent",
          attributes: { tone: "info" },
          children: [{ type: "strong", attributes: { class: "label" } }],
        },
        { type: "text", value: " " },
        { type: "strong", attributes: { class: "bold" } },
      ],
    });
  });

  it("promotes detached terminal attributes instead of attaching them to a span", () => {
    expect(parse("A [span] {.paragraph}\n", { attributes: true, component: true }).children[0])
      .toMatchObject({
        type: "paragraph",
        attributes: { class: "paragraph" },
        children: [
          { type: "text", value: "A " },
          { type: "inlineComponent", name: "span", attributes: {} },
        ],
      });
  });

  it("keeps chained terminal attributes with their block owner", () => {
    const tree = parse("**strong** {.first}{.second}\n\n[span] {.third}{.fourth}\n", {
      attributes: true,
      component: true,
    });
    expect(tree.children).toMatchObject([
      {
        type: "paragraph",
        attributes: { class: "first second" },
        children: [{ type: "strong" }],
      },
      {
        type: "paragraph",
        attributes: { class: "third fourth" },
        children: [{ type: "inlineComponent", name: "span", attributes: {} }],
      },
    ]);
    expect(tree.children[0]).not.toHaveProperty("children.0.attributes");
  });

  it("promotes a single attributed paragraph to its blockquote", () => {
    const single = parse("> quote{.callout}\n", options).children[0];
    expect(single).toMatchObject({
      type: "blockquote",
      attributes: { class: "callout" },
      children: [{ type: "paragraph", children: [{ type: "text", value: "quote" }] }],
    });

    const multiple = parse("> first{.local}\n>\n> second\n", options).children[0];
    expect(multiple).not.toHaveProperty("attributes");
    expect(multiple).toMatchObject({
      type: "blockquote",
      children: [
        { type: "paragraph", attributes: { class: "local" } },
        { type: "paragraph" },
      ],
    });
  });

  it("leaves attribute syntax inert by default", () => {
    expect(parse("**text**{.bold}\n")).toEqual(parse("**text**{.bold}\n", { attributes: false }));
  });

  it("keeps return types tied to both capabilities", () => {
    expectTypeOf(parse("", options)).toEqualTypeOf<Root>();
    expectTypeOf(parse("", { component: true })).toEqualTypeOf<Root>();
    expectTypeOf(parse("", { attributes: true, component: true })).toEqualTypeOf<Root>();
    expectTypeOf(parse("")).toEqualTypeOf<Root>();
    expectTypeOf(createDocument("", options)).toEqualTypeOf<Document>();
  });

  it("keeps full and incremental projection identical", () => {
    const document = createDocument("**text**{.old}\n", options);
    const start = document.source.indexOf("old");
    document.edit([{ start, end: start + 3, text: "new bright" }]);
    expect(document.snapshot()).toEqual(parse(document.source, options));
    expect(document.snapshot().children[0]).toMatchObject({
      children: [{ type: "strong", attributes: { class: "new", ":bright": "true" } }],
    });
  });
});
