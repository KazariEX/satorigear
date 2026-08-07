import { describe, expect, it } from "vitest";
import { markdownDelimiterRuns, markdownInlineGrammar } from "../packages/satorigear/src/markdown-inline.ts";
import { createDelimiterParser, resolveDelimiterRuns } from "../vendors/monogram/src/delimiter-parser.ts";
import { createLexer } from "../vendors/monogram/src/gen-lexer.ts";

const lexer = createLexer(markdownInlineGrammar);

function tokenTypes(source: string): string[] {
  return resolveDelimiterRuns(source, lexer.tokenize(source), markdownDelimiterRuns).map((token) => token.type);
}

describe("generic delimiter-run resolver", () => {
  it("builds nested single and double delimiter pairs", () => {
    expect(tokenTypes("***foo***")).toEqual([
      "EmphasisOpen",
      "StrongOpen",
      "Text",
      "StrongClose",
      "EmphasisClose",
    ]);
    const tree = createDelimiterParser(markdownInlineGrammar, markdownDelimiterRuns).parse("***foo***", "InlineLines");
    expect(tree.children[0]).toMatchObject({ rule: "InlineLine" });
  });

  it("applies Unicode flanking and intraword configuration", () => {
    expect(tokenTypes("a_foo_")).toEqual(["Text", "Delimiter", "Text", "Delimiter"]);
    expect(tokenTypes("*$*alpha.")).toEqual(["Delimiter", "Text", "Delimiter", "Text"]);
    expect(tokenTypes("😀_foo_")).toEqual(["Text", "EmphasisOpen", "Text", "EmphasisClose"]);
  });

  it("prevents an unmatched inner delimiter from crossing a completed pair", () => {
    expect(tokenTypes("*foo __bar *baz bim__ bam*")).toEqual([
      "EmphasisOpen",
      "Text",
      "StrongOpen",
      "Text",
      "Delimiter",
      "Text",
      "StrongClose",
      "Text",
      "EmphasisClose",
    ]);
  });
});
