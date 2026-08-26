import { describe, expect, it } from "vitest";
import { createParser, type Emoji } from "../../packages/satorigear/src/index.ts";

const parser = createParser({ features: { emoji: true } });
const componentParser = createParser({ features: { component: true, emoji: true } });
const defaultParser = createParser();

function emojisOf(source: string, target = parser): Emoji[] {
  const block = target.parse(source).children[0];
  return block?.type === "paragraph"
    ? block.children.filter((node): node is Emoji => node.type === "emoji")
    : [];
}

describe("emoji", () => {
  it("preserves complete Comark shortcodes and their source positions", () => {
    const emojis = emojisOf("Hello :smile: :+1: :100: :CUSTOM_2: :team-specific:");
    expect(emojis.map((node) => node.value)).toEqual([
      ":smile:",
      ":+1:",
      ":100:",
      ":CUSTOM_2:",
      ":team-specific:",
    ]);
    expect(emojis[0]?.position).toEqual({
      start: { line: 1, column: 7, offset: 6 },
      end: { line: 1, column: 14, offset: 13 },
    });
  });

  it.each([
    ["word:smile:", []],
    ["12:30:", []],
    ["::smile:", []],
    [":a.b: :a/b: :$name: ::", []],
    ["中:smile: (:wave:)", [":smile:", ":wave:"]],
    [":smile::wave:", [":smile:"]],
  ])("applies shortcode grammar and component boundaries to %j", (source, expected) => {
    expect(emojisOf(source).map((node) => node.value)).toEqual(expected);
  });

  it("wins closed shortcodes while preserving opaque and disabled syntax", () => {
    const block = componentParser.parse(":smile: :Badge[text] :Icon").children[0];
    expect(block).toMatchObject({
      children: [
        { type: "emoji", value: ":smile:" },
        { type: "text" },
        { type: "inlineComponent", name: "badge" },
        { type: "text" },
        { type: "inlineComponent", name: "icon" },
      ],
    });
    expect(emojisOf("\\:smile: `:wave:`")).toEqual([]);
    expect(emojisOf(":smile:", defaultParser)).toEqual([]);
  });

  it("keeps incremental recognition equivalent to a fresh parse", () => {
    const document = parser.createDocument("before :smile after\n");
    let offset = document.source.indexOf("smile") + "smile".length;
    document.edit([{ start: offset, end: offset, text: ":" }]);
    expect(document.tree).toEqual(parser.parse(document.source));
    expect(emojisOf(document.source).map((node) => node.value)).toEqual([":smile:"]);

    offset = document.source.indexOf("smile");
    document.edit([{ start: offset, end: offset + 1, text: "." }]);
    expect(document.tree).toEqual(parser.parse(document.source));
    expect(emojisOf(document.source)).toEqual([]);
  });
});
