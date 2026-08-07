import {
  alt,
  defineGrammar,
  many1,
  never,
  noneOf,
  plus,
  rule,
  seq,
  token,
} from "monogram/api.ts";
import { createCompositeParser } from "monogram/composite-parser.ts";
import { createParser, type CstChild, type CstLeaf, type CstNode, getText } from "monogram/gen-parser.ts";
import { createSourceView } from "monogram/source-view.ts";
import { describe, expect, it } from "vitest";
import type { Token } from "monogram/gen-lexer.ts";
import markdown from "../packages/satorigear/src/grammar.ts";

function leaves(node: CstNode): CstLeaf[] {
  const result: CstLeaf[] = [];
  const visit = (child: CstChild): void => {
    if ("tokenType" in child) {
      result.push(child);
    }
    else {
      child.children.forEach(visit);
    }
  };
  node.children.forEach(visit);
  return result;
}

function named(type: string, text: string, offset: number): Token {
  return {
    type,
    text,
    offset,
    k: 0,
    t: 0,
    newlineBefore: false,
    commentBefore: false,
    multilineFlowBefore: false,
  };
}

describe("parseTokens", () => {
  it("matches the ordinary tokenize-then-parse path", () => {
    const parser = createParser(markdown);
    const source = "# heading\n\nparagraph with `code`\n";
    const tokens = parser.tokenize(source);
    expect(parser.parseTokens(source, tokens)).toEqual(parser.parse(source));
  });

  it("preserves a caller-supplied logical token value across discontinuous ranges", () => {
    const Logical = token(never());
    const Document = rule(() => [Logical]);
    const parser = createParser(defineGrammar({
      name: "logical-token-test",
      tokens: { Logical },
      rules: { Document },
      entry: Document,
    }));
    const source = "a>b";
    const logical = {
      ...named("Logical", "a b", 0),
      ranges: [{ offset: 0, end: 1 }, { offset: 2, end: 3 }],
    };
    const tree = parser.parseTokens(source, [logical]);
    const leaf = leaves(tree)[0];
    expect(leaf.ranges).toEqual(logical.ranges);
    expect(getText(leaf, source)).toBe("a b");
  });
});

describe("source view", () => {
  it("joins logical content while retaining original ranges", () => {
    const source = "> abc\n> def";
    const view = createSourceView(source, [
      { offset: 2, end: 6 },
      { offset: 8, end: 11 },
    ]);
    expect(view.text).toBe("abc\ndef");
    expect(view.mapRange(1, 6)).toEqual([
      { offset: 3, end: 6 },
      { offset: 8, end: 10 },
    ]);
  });

  it("rejects overlapping source ranges", () => {
    expect(() => createSourceView("abcdef", [
      { offset: 1, end: 4 },
      { offset: 3, end: 5 },
    ])).toThrow(/ordered and non-overlapping/);
  });
});

describe("composite parser", () => {
  const InlineChunk = token(never());
  const Paragraph = rule(() => [[many1(InlineChunk)]]);
  const BlockDocument = rule(() => [Paragraph]);
  const blockGrammar = defineGrammar({
    name: "composite-test-block",
    tokens: { InlineChunk },
    rules: { Paragraph, BlockDocument },
    entry: BlockDocument,
  });

  const CodeSpan = token(seq("`", plus(noneOf("`")), "`"), {
    delimitedSpan: { markers: ["`"], minLength: 1, multiline: true },
  });
  const Text = token(plus(noneOf("`")));
  const Delimiter = token("`");
  const Inline = rule(() => [alt(CodeSpan, Text, Delimiter)]);
  const InlineDocument = rule(() => [[many1(Inline)]]);
  const inlineGrammar = defineGrammar({
    name: "composite-test-inline",
    tokens: { CodeSpan, Text, Delimiter },
    rules: { Inline, InlineDocument },
    entry: InlineDocument,
  });

  const outer = createParser(blockGrammar);
  const inner = createParser(inlineGrammar);
  const source = "> `foo\n> bar`\n";
  const outerTokens = (value: string): Token[] => [
    named("InlineChunk", value.slice(2, 7), 2),
    named("InlineChunk", value.slice(9, 13), 9),
  ];
  const parser = createCompositeParser({
    outer,
    outerTokens,
    regions: [{
      within: ["Paragraph"],
      contentToken: "InlineChunk",
      inner,
      entryRule: "InlineDocument",
    }],
  });

  it("parses inner content without exposing removed container prefixes", () => {
    const tree = parser.parse(source);
    const code = leaves(tree).find((leaf) => leaf.tokenType === "CodeSpan");
    expect(code).toBeDefined();
    expect(code?.ranges).toEqual([
      { offset: 2, end: 7 },
      { offset: 9, end: 13 },
    ]);
    expect(getText(code!, source)).toBe("`foo\nbar`");
  });

  it("keeps the inner CST under the owning block rule", () => {
    const tree = parser.parse(source);
    const paragraph = tree.children.find((child): child is CstNode => !("tokenType" in child));
    expect(paragraph?.rule).toBe("Paragraph");
    expect(paragraph?.children).toHaveLength(1);
    expect((paragraph?.children[0] as CstNode).rule).toBe("InlineDocument");
  });
});
