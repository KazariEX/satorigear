import { resolveDelimitedTokens } from "monogram/delimiter-parser.ts";
import { createLexer, type Token } from "monogram/gen-lexer.ts";
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

type BlockParser = ReturnType<typeof blockRuntime.createParser>;
type BlockHandle = ReturnType<BlockParser["parseTokens"]>;

function tokenStart(token: Token): number {
  return token.ranges?.[0]?.offset ?? token.offset;
}

function tokenEnd(token: Token): number {
  return token.ranges?.at(-1)?.end ?? token.offset + token.text.length;
}

function tokenMatchesAfterShift(previous: Token, next: Token, shift: number): boolean {
  if (previous.type !== next.type || previous.text !== next.text
    || previous.newlineBefore !== next.newlineBefore
    || previous.commentBefore !== next.commentBefore
    || previous.multilineFlowBefore !== next.multilineFlowBefore) {
    return false;
  }
  const previousRanges = previous.ranges ?? [{ offset: previous.offset, end: previous.offset + previous.text.length }];
  const nextRanges = next.ranges ?? [{ offset: next.offset, end: next.offset + next.text.length }];
  return previousRanges.length === nextRanges.length && previousRanges.every((range, index) => (
    range.offset + shift === nextRanges[index].offset && range.end + shift === nextRanges[index].end
  ));
}

function changedTokens(previous: readonly Token[], next: readonly Token[], shift: number) {
  const common = Math.min(previous.length, next.length);
  let start = 0;
  while (start < common && tokenMatchesAfterShift(previous[start], next[start], 0)) {
    start++;
  }
  let suffix = 0;
  while (suffix < common - start
    && tokenMatchesAfterShift(previous[previous.length - 1 - suffix], next[next.length - 1 - suffix], shift)) {
    suffix++;
  }
  return {
    oldStart: start,
    oldEnd: previous.length - suffix,
    tokens: next.slice(start, next.length - suffix),
  };
}

function arenaSnapshot(parser: BlockParser, handle: BlockHandle, tokens: readonly Token[]): unknown {
  const visit = (id: number, offset: number, tokenBase: number): unknown => ({
    rule: parser.tree.ruleNameOf(id),
    offset,
    end: offset + parser.tree.lenOf(id),
    children: Array.from({ length: parser.tree.childCount(id) }, (_, index) => {
      const entry = parser.tree.childAt(id, index);
      if (entry < 0) {
        const tokenIndex = parser.tree.leafToken(entry, tokenBase);
        const token = tokens[tokenIndex];
        return {
          tokenType: parser.tree.leafTokenType(entry, tokenBase),
          offset: tokenStart(token),
          end: tokenEnd(token),
          text: token.text,
        };
      }
      return visit(
        entry,
        offset + parser.tree.childRelAt(id, index),
        tokenBase + parser.tree.childTokRelAt(id, index),
      );
    }),
  });
  return visit(handle.root, tokenStart(tokens[0]), 0);
}

function ruleIds(parser: BlockParser, handle: BlockHandle, rule: string): number[] {
  const result: number[] = [];
  const visit = (id: number): void => {
    if (parser.tree.ruleNameOf(id) === rule) {
      result.push(id);
    }
    for (let index = 0; index < parser.tree.childCount(id); index++) {
      const entry = parser.tree.childAt(id, index);
      if (entry >= 0) {
        visit(entry);
      }
    }
  };
  visit(handle.root);
  return result;
}

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

  it("edits external token streams through the emitted arena", () => {
    const source = "first\n\nsecond\n\nthird\n\nfourth\n\nfifth\n";
    const nextSource = "first\n\nsecond\n\nchanged middle\n\nfourth\n\nfifth\n";
    const tokens = tokenizeMarkdownBlocks(source);
    const nextTokens = tokenizeMarkdownBlocks(nextSource);
    const parser = blockRuntime.createParser();
    const handle = parser.parseTokens(source, tokens);
    const blocks = ruleIds(parser, handle, "Block");
    const tokenChange = changedTokens(tokens, nextTokens, nextSource.length - source.length);
    expect(tokenChange.oldStart).toBeGreaterThan(0);

    parser.editTokens(
      handle,
      [{ start: 15, end: 20, text: "changed middle" }],
      tokenChange,
    );

    const freshParser = blockRuntime.createParser();
    const fresh = freshParser.parseTokens(nextSource, nextTokens);
    expect(arenaSnapshot(parser, handle, nextTokens)).toEqual(arenaSnapshot(freshParser, fresh, nextTokens));
    const nextBlocks = ruleIds(parser, handle, "Block");
    expect(nextBlocks[0]).toBe(blocks[0]);
    expect(nextBlocks[1]).not.toBe(blocks[1]);
    expect(nextBlocks[4]).toBe(blocks[4]);
  });

  it("accepts token-only changes on an external document", () => {
    const source = "text\n";
    const tokens = tokenizeMarkdownBlocks(source);
    const headingTokens = tokens.map((token) => ({
      ...token,
      type: token.type === "ParagraphOpen"
        ? "AtxHeadingOpen"
        : token.type === "ParagraphClose" ? "HeadingClose" : token.type,
    }));
    const parser = blockRuntime.createParser();
    const handle = parser.parseTokens(source, tokens);

    parser.editTokens(handle, [], { oldStart: 0, oldEnd: tokens.length, tokens: headingTokens });

    const freshParser = blockRuntime.createParser();
    const fresh = freshParser.parseTokens(source, headingTokens);
    expect(arenaSnapshot(parser, handle, headingTokens)).toEqual(arenaSnapshot(freshParser, fresh, headingTokens));
    expect(ruleIds(parser, handle, "AtxHeading")).toHaveLength(1);
  });
});
