import { describe, expect, expectTypeOf, it } from "vitest";
import type { Root } from "mdast";
import {
  type BlockComponent,
  createParser,
  type Document,
  type InlineComponent,
  type TextEdit,
} from "../../packages/satorigear/src/index.ts";

const parser = createParser({ features: { attributes: true, component: true } });
const componentParser = createParser({ features: { component: true } });
const defaultParser = createParser();

function component(source: string): BlockComponent | InlineComponent {
  const node = parser.parse(source).children[0];
  if (node.type === "paragraph") {
    return node.children[0] as InlineComponent;
  }
  return node as BlockComponent;
}

describe("component", () => {
  it("keeps component recognition independent from attribute parsing", () => {
    const tree = componentParser.parse(":Card{tone=info} [span]{.mark}\n");
    expect(tree.children[0]).toMatchObject({
      type: "paragraph",
      children: [
        { type: "inlineComponent", name: "card", attributes: {} },
        { type: "text", value: "{tone=info} " },
        { type: "inlineComponent", name: "span", attributes: {} },
        { type: "text", value: "{.mark}" },
      ],
    });
    expect(componentParser.parse("::Card{tone=info}\n#header{.wide}\nbody\n::\n").children[0]).toMatchObject({
      type: "blockComponent",
      name: "card",
      attributes: { tone: "info" },
      children: [{
        type: "blockComponent",
        name: "template",
        attributes: { class: "wide", name: "header" },
      }],
    });
    expect(componentParser.parse("::Card\n---\ncount: 42\n---\n::\n").children[0]).toMatchObject({
      type: "blockComponent",
      children: [{ type: "yaml", value: "count: 42" }],
    });
  });

  it("builds fenced block components with normalized names and attributes", () => {
    const source = "::AlertBox[**Warning**]{kind=notice disabled disabled=\"true\" .wide .bright #first #last}\nbody\n::\n";
    expect(component(source)).toEqual({
      type: "blockComponent",
      name: "alert-box",
      attributes: {
        kind: "notice",
        ":disabled": "true",
        disabled: "true",
        class: "wide bright",
        id: "last",
      },
      children: [
        {
          type: "paragraph",
          children: [{
            type: "strong",
            children: [{ type: "text", value: "Warning", position: expect.any(Object) }],
            position: expect.any(Object),
          }],
          position: expect.any(Object),
        },
        {
          type: "paragraph",
          children: [{ type: "text", value: "body", position: expect.any(Object) }],
          position: expect.any(Object),
        },
      ],
      position: {
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 3, column: 3, offset: source.length - 1 },
      },
    });
  });

  it("accepts block spacing while keeping shorthand strict", () => {
    expect(component("::  AlertBox [Label] {.wide}\n::\n")).toMatchObject({
      type: "blockComponent",
      name: "alert-box",
      attributes: { class: "wide" },
    });
    expect(parser.parse(": Alert\n").children[0]).toMatchObject({ type: "paragraph" });
  });

  it("matches nested component fences and ignores closers inside code fences", () => {
    const source = "::outer\n::inner\n```\n::\n```\n::\n::\n";
    const outer = component(source) as BlockComponent;
    expect(outer.children[0]).toMatchObject({
      type: "blockComponent",
      name: "inner",
      children: [{ type: "code", value: "::" }],
    });
    expect(outer.position?.end.offset).toBe(source.length - 1);
  });

  it("does not treat an invalid backtick fence as fenced code", () => {
    expect(component("::alert\n``` foo`bar\n::\n")).toMatchObject({
      type: "blockComponent",
      name: "alert",
    });
  });

  it("captures YAML props as an uninterpreted node before component content", () => {
    const source = `::DataCard{count="inline"}
---
count: 42
enabled: true
empty: null
items:
  - one
  - two
config:
  mode: dark
published: 2025-08-10
---
Body
::
`;
    const value = component(source) as BlockComponent;
    expect(value.attributes).toEqual({ count: "inline" });
    expect(value.children[0]).toMatchObject({ type: "yaml" });
    expect(value.children.at(-1)).toMatchObject({ type: "paragraph", children: [{ type: "text", value: "Body" }] });
    const yaml = value.children[0] as { type: string; value: string };
    expect(yaml.value).toContain("enabled: true");
    expect(yaml.value).toContain("config:");
    expect(yaml.value).toContain("  mode: dark");
  });

  it("builds YAML props from container-stripped text", () => {
    expect(parser.parse("> ::card\n> ---\n> a: b\n> ---\n> ::\n").children[0]).toMatchObject({
      type: "blockquote",
      children: [{
        type: "blockComponent",
        children: [{ type: "yaml", value: "a: b" }],
      }],
    });
  });

  it("recognizes YAML props code fences without emitting code nodes", () => {
    for (const [open, close] of [
      ["```yaml [props]", "```"],
      ["~~~yml [props]", "~~~"],
    ]) {
      const value = component(`::card\n${open}\ncount: 42\n${close}\nBody\n::\n`) as BlockComponent;
      expect(value.children[0]).toMatchObject({ type: "yaml", value: "count: 42" });
      expect(value.children.at(-1)).toMatchObject({ type: "paragraph" });
      expect(value.children.some((node) => node.type === "code")).toBe(false);
    }
  });

  it("builds explicit default and named slots as template components", () => {
    const source = `::card
#default
Body
#footer{.wide}
Before
\`\`\`
#not-a-slot
::
\`\`\`
After
::
`;
    const value = component(source) as BlockComponent;
    expect(value).toMatchObject({
      children: [
        {
          type: "blockComponent",
          name: "template",
          attributes: { name: "default" },
          children: [{ type: "paragraph", children: [{ type: "text", value: "Body" }] }],
        },
        {
          type: "blockComponent",
          name: "template",
          attributes: { class: "wide", name: "footer" },
          children: [
            { type: "paragraph" },
            { type: "code", value: "#not-a-slot\n::" },
            { type: "paragraph", children: [{ type: "text", value: "After" }] },
          ],
        },
      ],
    });
    expect(value.children[0]?.position).toEqual({
      start: { line: 2, column: 1, offset: source.indexOf("#default") },
      end: { line: 4, column: 1, offset: source.indexOf("#footer") },
    });
    expect(value.children[1]?.position).toEqual({
      start: { line: 4, column: 1, offset: source.indexOf("#footer") },
      end: { line: 11, column: 1, offset: source.lastIndexOf("::\n") },
    });
  });

  it("keeps nested components inside their current slot", () => {
    const source = `::outer
#content
Before
:::child
Inside
:::
After
#footer
End
::
`;
    expect(component(source)).toMatchObject({
      children: [
        {
          type: "blockComponent",
          name: "template",
          attributes: { name: "content" },
          children: [
            { type: "paragraph", children: [{ type: "text", value: "Before" }] },
            {
              type: "blockComponent",
              name: "child",
              children: [{ type: "paragraph", children: [{ type: "text", value: "Inside" }] }],
            },
            { type: "paragraph", children: [{ type: "text", value: "After" }] },
          ],
        },
        {
          type: "blockComponent",
          name: "template",
          attributes: { name: "footer" },
          children: [{ type: "paragraph", children: [{ type: "text", value: "End" }] }],
        },
      ],
    });
  });

  it("only consumes YAML props at the beginning of component content", () => {
    const value = component("::card\nBody\n---\ncount: 42\n---\n::\n") as BlockComponent;
    expect(value.children.some((node) => node.type === "yaml")).toBe(false);
  });

  it("keeps invalid closed component YAML as an uninterpreted node", () => {
    expect(component("::card\n---\nitems: [\n---\n::\n")).toMatchObject({
      type: "blockComponent",
      children: [{ type: "yaml", value: "items: [" }],
    });
  });

  it("supports nested components with independent fence sizes", () => {
    const source = "::::outer\n::inner\ninside\n::\n::::\n";
    expect(component(source)).toMatchObject({
      name: "outer",
      children: [{
        type: "blockComponent",
        name: "inner",
        children: [{ type: "paragraph", children: [{ type: "text", value: "inside" }] }],
      }],
    });
  });

  it("does not auto-close unmatched block fences", () => {
    expect(parser.parse("::alert\nbody\n").children.some(
      (node) => node.type === "blockComponent",
    )).toBe(false);
  });

  it("supports line-start block shorthand", () => {
    const tree = parser.parse(":Badge[**New**]{tone=info}\ntext :Icon\n");
    expect(tree.children[0]).toMatchObject({
      type: "blockComponent",
      name: "badge",
      attributes: { tone: "info" },
      children: [{ type: "paragraph", children: [{ type: "strong" }] }],
    });
    expect(tree.children[1]).toMatchObject({
      type: "paragraph",
      children: [
        { type: "text", value: "text " },
        { type: "inlineComponent", name: "icon", children: [] },
      ],
    });
  });

  it("builds inline leaf, container, props-only and nested components", () => {
    const source = "before :Icon :Badge[**New :Dot**]{:items=[\"a\",\"b\"]} :Card{disabled} after\n";
    expect(parser.parse(source).children[0]).toMatchObject({
      type: "paragraph",
      children: [
        { type: "text", value: "before " },
        { type: "inlineComponent", name: "icon", attributes: {}, children: [] },
        { type: "text", value: " " },
        {
          type: "inlineComponent",
          name: "badge",
          attributes: { ":items": "[\"a\",\"b\"]" },
          children: [{
            type: "strong",
            children: [
              { type: "text", value: "New " },
              { type: "inlineComponent", name: "dot", children: [] },
            ],
          }],
        },
        { type: "text", value: " " },
        {
          type: "inlineComponent",
          name: "card",
          attributes: { ":disabled": "true" },
          children: [],
        },
        { type: "text", value: " after" },
      ],
    });
  });

  it("parses normal inline syntax inside component labels", () => {
    const source = "See :Badge[![icon](i.png) [docs](https://x.dev) :Inner[:Leaf]] here\n";
    expect(parser.parse(source).children[0]).toMatchObject({
      type: "paragraph",
      children: [
        { type: "text", value: "See " },
        {
          type: "inlineComponent",
          name: "badge",
          children: [
            { type: "image", url: "i.png", alt: "icon" },
            { type: "text", value: " " },
            { type: "link", url: "https://x.dev" },
            { type: "text", value: " " },
            {
              type: "inlineComponent",
              name: "inner",
              children: [{ type: "inlineComponent", name: "leaf" }],
            },
          ],
        },
        { type: "text", value: " here" },
      ],
    });
  });

  it("keeps invalid component names as text", () => {
    const source = ":8100\n\n::8100\nbody\n::\n";
    expect(JSON.stringify(parser.parse(source))).not.toContain("blockComponent");
    expect(JSON.stringify(parser.parse(source))).not.toContain("inlineComponent");
  });

  it("does not pair component brackets across inline regions", () => {
    const tree = parser.parse(":Badge[open\n\nclose]\n");
    expect(tree.children[0]).toMatchObject({
      type: "paragraph",
      children: [
        { type: "inlineComponent", name: "badge", children: [] },
        { type: "text", value: "[open" },
      ],
    });
  });

  it("does not consume component attributes across inline regions", () => {
    const tree = parser.parse(":Card{open\n\nclose}\n");
    expect(tree.children[0]).toMatchObject({
      type: "paragraph",
      children: [
        { type: "inlineComponent", name: "card", attributes: {} },
        { type: "text", value: "{open" },
      ],
    });
  });

  it("does not consume component attributes across soft line endings", () => {
    expect(parser.parse(":Card{open\nclose}\n").children[0]).toMatchObject({
      type: "paragraph",
      children: [
        { type: "inlineComponent", name: "card", attributes: {} },
        { type: "text", value: "{open\nclose}" },
      ],
    });
  });

  it("represents bare and attributed spans as inline components", () => {
    const tree = parser.parse("[plain] [**bold**]{.lead #main}\n");
    expect(tree.children[0]).toMatchObject({
      type: "paragraph",
      children: [
        {
          type: "inlineComponent",
          name: "span",
          attributes: {},
          children: [{ type: "text", value: "plain" }],
        },
        { type: "text", value: " " },
        {
          type: "inlineComponent",
          name: "span",
          attributes: { class: "lead", id: "main" },
          children: [{ type: "strong" }],
        },
      ],
    });
  });

  it("isolates delimiter pairing at component boundaries", () => {
    expect(componentParser.parse("*foo [bar* baz]\n").children[0]).toMatchObject({
      children: [
        { type: "text", value: "*foo " },
        {
          type: "inlineComponent",
          name: "span",
          children: [{ type: "text", value: "bar* baz" }],
        },
      ],
    });
    expect(componentParser.parse("[foo*]: /url\n\n*[foo*]\n").children[1]).toMatchObject({
      children: [
        { type: "text", value: "*" },
        {
          type: "inlineComponent",
          name: "span",
          children: [{ type: "text", value: "foo*" }],
        },
      ],
    });
  });

  it("keeps direct links and full references ahead of spans", () => {
    const source = "[direct](/url) [full][ref] [shortcut]\n\n[ref]: /ref\n[shortcut]: /shortcut\n";
    expect(parser.parse(source).children[0]).toMatchObject({
      type: "paragraph",
      children: [
        { type: "link", url: "/url" },
        { type: "text", value: " " },
        { type: "linkReference", identifier: "ref" },
        { type: "text", value: " " },
        { type: "inlineComponent", name: "span" },
      ],
    });
  });

  it("supports component and attributed span content inside links", () => {
    expect(parser.parse("[:Icon ![alt](image.png) [label]{.mark}](/url)\n").children[0]).toMatchObject({
      type: "paragraph",
      children: [{
        type: "link",
        url: "/url",
        children: [
          { type: "inlineComponent", name: "icon" },
          { type: "text", value: " " },
          { type: "image", url: "image.png", alt: "alt" },
          { type: "text", value: " " },
          { type: "inlineComponent", name: "span", attributes: { class: "mark" } },
        ],
      }],
    });
  });

  it("does not activate nested links through component labels", () => {
    expect(parser.parse("[:Badge[[nested](inner)]](outer)\n").children[0]).toMatchObject({
      type: "paragraph",
      children: [{
        type: "link",
        url: "outer",
        children: [{
          type: "inlineComponent",
          name: "badge",
          children: [{ type: "text", value: "[nested](inner)" }],
        }],
      }],
    });
  });

  it("keeps link-like suffixes outside component labels", () => {
    expect(parser.parse(":Badge[text](url) :Chip[text][ref]\n").children[0]).toMatchObject({
      type: "paragraph",
      children: [
        { type: "inlineComponent", name: "badge", children: [{ type: "text", value: "text" }] },
        { type: "text", value: "(url) " },
        { type: "inlineComponent", name: "chip", children: [{ type: "text", value: "text" }] },
        { type: "inlineComponent", name: "span", children: [{ type: "text", value: "ref" }] },
      ],
    });
  });

  it("leaves component markers inert in the default profile", () => {
    const source = "::Alert\nbody\n::\n\n:Icon [span]\n";
    const tree = defaultParser.parse(source);
    expect(JSON.stringify(tree)).not.toContain("blockComponent");
    expect(JSON.stringify(tree)).not.toContain("inlineComponent");
  });

  it("keeps public return types tied to the selected capability", () => {
    expectTypeOf(defaultParser.parse("")).toEqualTypeOf<Root>();
    expectTypeOf(parser.parse("")).toEqualTypeOf<Root>();
    expectTypeOf(parser.createDocument("")).toEqualTypeOf<Document>();
    expectTypeOf(defaultParser.createDocument("")).toEqualTypeOf<Document>();
  });

  it("keeps full and incremental ASTs identical", () => {
    const document = parser.createDocument("::Card{tone=old}\nHello :Badge[old]\n::\n");
    const edit = (batch: TextEdit[]): void => {
      document.edit(batch);
      expect(document.tree).toEqual(parser.parse(document.source));
    };

    let start = document.source.indexOf("old");
    edit([{ start, end: start + 3, text: "new" }]);
    start = document.source.lastIndexOf("old");
    edit([{ start, end: start + 3, text: "**new**" }]);
    const close = document.source.lastIndexOf("::\n");
    edit([
      { start: 0, end: 2, text: ":::" },
      { start: close, end: close + 2, text: ":::" },
    ]);
    start = document.source.indexOf("Hello");
    edit([{ start, end: start, text: "[intro] " }]);
    expect(document.tree.children[0]).toMatchObject({
      type: "blockComponent",
      attributes: { tone: "new" },
      children: [{
        type: "paragraph",
        children: [
          { type: "inlineComponent", name: "span" },
          { type: "text", value: " Hello " },
          { type: "inlineComponent", name: "badge", children: [{ type: "strong" }] },
        ],
      }],
    });
  });

  it("updates YAML props and slots through the existing incremental path", () => {
    const document = parser.createDocument("::card\n---\ncount: 1\n---\n#header\nTitle\n::\n");
    let start = document.source.indexOf("1");
    document.edit([{ start, end: start + 1, text: "2" }]);
    expect(document.tree).toEqual(parser.parse(document.source));
    expect(document.tree.children[0]).toMatchObject({
      children: [{ type: "yaml", value: "count: 2" }, { attributes: { name: "header" } }],
    });

    start = document.source.indexOf("header");
    document.edit([{ start, end: start + 6, text: "footer" }]);
    expect(document.tree).toEqual(parser.parse(document.source));
    expect(document.tree.children[0]).toMatchObject({
      children: [{ type: "yaml" }, { attributes: { name: "footer" } }],
    });

    start = document.source.indexOf("#footer");
    document.edit([{ start, end: start + 1, text: "" }]);
    expect(document.tree).toEqual(parser.parse(document.source));
    expect(document.tree.children[0]).toMatchObject({
      children: [{ type: "yaml" }, { type: "paragraph", children: [{ type: "text", value: "footer\nTitle" }] }],
    });
    document.edit([{ start, end: start, text: "#" }]);
    expect(document.tree).toEqual(parser.parse(document.source));
    expect(document.tree.children[0]).toMatchObject({
      children: [{ type: "yaml" }, { type: "blockComponent", attributes: { name: "footer" } }],
    });
  });

  it("invalidates an earlier component opener when an edit closes it", () => {
    // The failed opener precedes two records that the default one-record lookbehind cannot reach.
    const document = parser.createDocument("::Card\n# heading\nx");
    document.edit([{
      start: document.source.length,
      end: document.source.length,
      text: "\n::\n",
    }]);
    expect(document.tree).toEqual(parser.parse(document.source));
    expect(document.tree.children.at(-1)).toMatchObject({
      type: "blockComponent",
      name: "card",
    });

    const close = document.source.lastIndexOf("::\n");
    document.edit([{ start: close, end: close + 3, text: "" }]);
    expect(document.tree).toEqual(parser.parse(document.source));
    expect(document.tree.children.some(
      (node) => node.type === "blockComponent",
    )).toBe(false);
  });
});
