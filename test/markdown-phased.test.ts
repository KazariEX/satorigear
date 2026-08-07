import { describe, expect, it } from "vitest";
import { markdownPhasedParser } from "../packages/satorigear/src/markdown-parser.ts";
import { type CstChild, type CstLeaf, type CstNode, getText } from "../vendors/monogram/src/gen-parser.ts";

function rules(node: CstNode): string[] {
  const result = [node.rule];
  for (const child of node.children) if (!("tokenType" in child)) result.push(...rules(child));
  return result;
}

function leaves(node: CstNode): CstLeaf[] {
  const result: CstLeaf[] = [];
  const visit = (child: CstChild): void => {
    if ("tokenType" in child) result.push(child);
    else child.children.forEach(visit);
  };
  node.children.forEach(visit);
  return result;
}

describe("block-first markdown parser", () => {
  it("allows a code span to cross lines inside one paragraph", () => {
    const source = "``foo\nbar``\n";
    const tree = markdownPhasedParser.parse(source);
    expect(rules(tree).filter((rule) => rule === "Paragraph")).toHaveLength(1);
    expect(leaves(tree).some((leaf) => leaf.tokenType === "CodeSpan")).toBe(true);
  });

  it("does not allow a code span to cross a new list item", () => {
    const tree = markdownPhasedParser.parse("- `one\n- two`\n");
    expect(rules(tree).filter((rule) => rule === "UnorderedListItem")).toHaveLength(2);
    expect(leaves(tree).some((leaf) => leaf.tokenType === "CodeSpan")).toBe(false);
  });

  it("removes block quote prefixes from a multiline inline source view", () => {
    const source = "> `foo\n> bar`\n";
    const tree = markdownPhasedParser.parse(source);
    const code = leaves(tree).find((leaf) => leaf.tokenType === "CodeSpan");
    expect(code?.ranges).toEqual([
      { offset: 2, end: 7 },
      { offset: 9, end: 13 },
    ]);
    expect(getText(code!, source)).toBe("`foo\nbar`");
  });

  it("classifies initial leaf block forms before inline parsing", () => {
    const source = "# atx\n\nsetext\n===\n\n---\n\n```\ncode\n```\n\n    indented\n";
    const treeRules = rules(markdownPhasedParser.parse(source));
    for (const rule of ["AtxHeading", "SetextHeading", "ThematicBreak", "FencedCode", "IndentedCodeBlock"]) {
      expect(treeRules).toContain(rule);
    }
  });

  it("preserves nested list ownership when a tab is only partly consumed", () => {
    const treeRules = rules(markdownPhasedParser.parse(" - foo\n   - bar\n\t - baz\n"));
    expect(treeRules.filter((rule) => rule === "UnorderedList")).toHaveLength(3);
    expect(treeRules.filter((rule) => rule === "UnorderedListItem")).toHaveLength(3);
  });

  it("propagates lazy continuation through nested containers", () => {
    const treeRules = rules(markdownPhasedParser.parse("> 1. > Blockquote\ncontinued here.\n"));
    expect(treeRules.filter((rule) => rule === "BlockQuote")).toHaveLength(2);
    expect(treeRules.filter((rule) => rule === "OrderedList")).toHaveLength(1);
    expect(treeRules.filter((rule) => rule === "Paragraph")).toHaveLength(1);
  });

  it("removes valid multiline definitions but retains invalid bracketed labels", () => {
    const source = "[Foo bar]:\n<my url>\n'title'\n\n[Foo bar]\n\n[ref[]: /uri\n";
    const treeRules = rules(markdownPhasedParser.parse(source));
    expect(treeRules.filter((rule) => rule === "Paragraph")).toHaveLength(2);
  });
});
