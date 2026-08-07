import { resolveDelimitedTokens } from "monogram/delimiter-parser.ts";
import { createLexer } from "monogram/gen-lexer.ts";
import { createParser } from "monogram/gen-parser.ts";
import { describe, expect, it } from "vitest";
import { createCstParser } from "../packages/satorigear/src/emitted-parser.ts";
import * as blockRuntime from "../packages/satorigear/src/generated/blocks.ts";
import * as inlineRuntime from "../packages/satorigear/src/generated/inline.ts";
import * as markdownRuntime from "../packages/satorigear/src/generated/markdown.ts";
import { markdownBlockGrammar, tokenizeMarkdownBlocks } from "../packages/satorigear/src/grammar-blocks.ts";
import {
  markdownBracketPairs,
  markdownDelimiterRuns,
  markdownInlineGrammar,
  reassociateMarkdownReferenceTails,
} from "../packages/satorigear/src/grammar-inline.ts";
import markdownGrammar from "../packages/satorigear/src/grammar.ts";

const documents = [
  "",
  "# heading\n\nParagraph with *emphasis* and [a link](/url).\n",
  "> 1. nested\n>    - item\n> continuation\n",
  "```ts\nconst value = 1;\n```\n",
];

describe("emitted parser", () => {
  it("matches the interpreter for the single-pass grammar", () => {
    const lexer = createLexer(markdownGrammar);
    const emitted = createCstParser(markdownRuntime, lexer.tokenize);
    const interpreted = createParser(markdownGrammar);
    for (const source of documents) {
      expect(emitted.parse(source)).toEqual(interpreted.parse(source));
    }
  });

  it("matches the interpreter for structural block tokens", () => {
    const emitted = createCstParser(blockRuntime, tokenizeMarkdownBlocks);
    const interpreted = createParser(markdownBlockGrammar);
    for (const source of documents) {
      const tokens = tokenizeMarkdownBlocks(source);
      expect(emitted.parseTokens(source, tokens)).toEqual(interpreted.parseTokens(source, tokens));
    }
  });

  it("matches the interpreter after inline delimiter resolution", () => {
    const labels = new Set(["reference"]);
    const lexer = createLexer(markdownInlineGrammar);
    const emitted = createCstParser(inlineRuntime, lexer.tokenize);
    const interpreted = createParser(markdownInlineGrammar);
    const sources = [
      "plain **strong** and *emphasis*",
      "[inline](/url) and [reference]",
      "``code\nspan`` and &amp;",
    ];
    for (const source of sources) {
      const tokens = reassociateMarkdownReferenceTails(source, lexer.tokenize(source), labels);
      const resolved = resolveDelimitedTokens(
        source,
        tokens,
        markdownDelimiterRuns,
        markdownBracketPairs(labels),
      );
      expect(emitted.parseTokens(source, resolved, "InlineLines"))
        .toEqual(interpreted.parseTokens(source, resolved, "InlineLines"));
    }
  });
});
