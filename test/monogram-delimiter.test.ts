import { describe, expect, it } from "vitest";
import { markdownBracketPairs, markdownDelimiterRuns, markdownInlineGrammar } from "../packages/satorigear/src/markdown-inline.ts";
import { createDelimiterParser, resolveDelimitedTokens, resolveDelimiterRuns } from "../vendors/monogram/src/delimiter-parser.ts";
import { createLexer } from "../vendors/monogram/src/gen-lexer.ts";

const lexer = createLexer(markdownInlineGrammar);

function tokenTypes(source: string): string[] {
  return resolveDelimiterRuns(source, lexer.tokenize(source), markdownDelimiterRuns).map((token) => token.type);
}

function pairedTokenTypes(source: string): string[] {
  const references = new Set(["CANDIDATE", "NESTED", "REF"]);
  return resolveDelimitedTokens(source, lexer.tokenize(source), markdownDelimiterRuns, markdownBracketPairs(references))
    .map((token) => token.type);
}

function selectedTokenTypes(source: string, selected: readonly string[]): string[] {
  const included = new Set(selected);
  return pairedTokenTypes(source).filter((type) => included.has(type));
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

  it("activates the nearest compatible structural opener", () => {
    const structural = ["BracketOpen", "LinkOpen", "LinkClose", "LinkTail"];
    expect(selectedTokenTypes("[outer [inner](/inner)](/outer)", structural)).toEqual(structural);
  });

  it("isolates delimiter runs inside an activated pair", () => {
    const structural = ["Delimiter", "EmphasisOpen", "EmphasisClose", "LinkOpen", "LinkClose"];
    expect(selectedTokenTypes("*[bar*](/url)", structural))
      .toEqual(["Delimiter", "LinkOpen", "Delimiter", "LinkClose"]);
    expect(selectedTokenTypes("*[bar](/url)*", structural))
      .toEqual(["EmphasisOpen", "LinkOpen", "LinkClose", "EmphasisClose"]);
  });

  it("preserves candidate pairs across surrounding delimiter runs", () => {
    const structural = ["Delimiter", "EmphasisOpen", "EmphasisClose", "ReferenceOpen", "ReferenceClose"];
    expect(selectedTokenTypes("*[candidate*][ref]", structural))
      .toEqual(["Delimiter", "ReferenceOpen", "Delimiter", "ReferenceClose"]);
  });

  it("rejects paired-token contents that violate declarative constraints", () => {
    expect(pairedTokenTypes("[]")).toEqual(["BracketOpen", "ShortcutReferenceTail"]);
    expect(pairedTokenTypes("[[nested]]").filter((type) => type === "ReferenceOpen")).toHaveLength(1);
    expect(pairedTokenTypes(`[${"a".repeat(1000)}]`)).not.toContain("ReferenceOpen");
  });
});
