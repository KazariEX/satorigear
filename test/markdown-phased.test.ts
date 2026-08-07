import { type CstChild, type CstLeaf, type CstNode, getText } from "monogram/gen-parser.ts";
import { describe, expect, it } from "vitest";
import { markdownPhasedParser } from "../packages/satorigear/src/parser.ts";

function rules(node: CstNode): string[] {
  const result = [node.rule];
  for (const child of node.children) {
    if (!("tokenType" in child)) {
      result.push(...rules(child));
    }
  }
  return result;
}

function nodes(node: CstNode, rule: string): CstNode[] {
  const result = node.rule === rule ? [node] : [];
  for (const child of node.children) {
    if (!("tokenType" in child)) {
      result.push(...nodes(child, rule));
    }
  }
  return result;
}

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

  it("recognizes valid multiline definitions but retains invalid bracketed labels", () => {
    const source = "[Foo bar]:\n<my url>\n'title'\n\n[Foo bar]\n\n[ref[]: /uri\n";
    const tree = markdownPhasedParser.parse(source);
    const treeRules = rules(tree);
    expect(treeRules.filter((rule) => rule === "LinkDefinition")).toHaveLength(1);
    expect(leaves(tree).filter((leaf) => leaf.tokenType === "LinkDefinitionChunk")).toHaveLength(3);
    expect(treeRules.filter((rule) => rule === "Paragraph")).toHaveLength(2);
  });

  it("recognizes definition labels spanning multiple nonblank lines", () => {
    const treeRules = rules(markdownPhasedParser.parse("[\nfoo\n]: /url\n\n[foo]\n"));
    expect(treeRules.filter((rule) => rule === "LinkDefinition")).toHaveLength(1);
    expect(treeRules.filter((rule) => rule === "ReferenceLink")).toHaveLength(1);
  });

  it("activates only references that match a document definition", () => {
    const tree = markdownPhasedParser.parse("[defined]\n\n[defined]: /url\n\n[missing]\n");
    expect(rules(tree).filter((rule) => rule === "LinkDefinition")).toHaveLength(1);
    expect(rules(tree).filter((rule) => rule === "ReferenceLink")).toHaveLength(1);
    expect(leaves(tree).filter((leaf) => leaf.tokenType === "LinkDefinitionChunk")).toHaveLength(1);
  });

  it("parses inline link labels as nested inline CST", () => {
    const tree = markdownPhasedParser.parse("[*label* `code`](/uri \"title\")\n");
    const treeRules = rules(tree);
    expect(treeRules).toContain("Link");
    expect(treeRules).toContain("LinkEmphasis");
    expect(leaves(tree).some((leaf) => leaf.tokenType === "CodeSpan")).toBe(true);
    expect(leaves(tree).some((leaf) => leaf.tokenType === "LinkClose")).toBe(true);
  });

  it("does not activate a concrete link inside another concrete link", () => {
    const source = "[outer [inner](/inner)](/outer)\n";
    const tree = markdownPhasedParser.parse(source);
    const treeRules = rules(tree);
    expect(treeRules.filter((rule) => rule === "Link")).toHaveLength(1);
    expect(nodes(tree, "Link").map((node) => getText(node, source))).toEqual(["[inner](/inner)"]);
  });

  it("lets an activated reference deactivate an earlier concrete link opener", () => {
    const treeRules = rules(markdownPhasedParser.parse("[outer [reference]](/outer)\n\n[reference]: /inner\n"));
    expect(treeRules.filter((rule) => rule === "Link")).toHaveLength(0);
    expect(treeRules.filter((rule) => rule === "ReferenceLink")).toHaveLength(1);
  });

  it("activates image references that match a document definition", () => {
    const treeRules = rules(markdownPhasedParser.parse("![*label*][target]\n\n[target]: /image\n"));
    expect(treeRules.filter((rule) => rule === "ReferenceImage")).toHaveLength(1);
    expect(treeRules.filter((rule) => rule === "Emphasis")).toHaveLength(1);
  });

  it("isolates emphasis only for an activated reference", () => {
    const treeRules = rules(markdownPhasedParser.parse("*[candidate*][ref]\n\n[ref]: /url\n"));
    expect(treeRules.filter((rule) => rule === "ReferenceLink")).toHaveLength(1);
    expect(treeRules.filter((rule) => rule === "Emphasis")).toHaveLength(0);
  });

  it("rejects invalid shortcut reference labels before CST activation", () => {
    expect(rules(markdownPhasedParser.parse("[]\n"))).not.toContain("ReferenceLink");
    const nested = rules(markdownPhasedParser.parse("![[foo]]\n\n[foo]: /url\n"));
    expect(nested).not.toContain("ReferenceImage");
    expect(nested.filter((rule) => rule === "ReferenceLink")).toHaveLength(1);
  });

  it("validates explicit reference labels against normalized definitions", () => {
    const invalidSource = "[text][   ]\n\n[text]: /url\n";
    expect(nodes(markdownPhasedParser.parse(invalidSource), "ReferenceLink").map((node) => getText(node, invalidSource)))
      .toEqual(["[text]"]);
    const collapsedSource = "[text][]\n\n[text]: /url\n";
    expect(nodes(markdownPhasedParser.parse(collapsedSource), "ReferenceLink").map((node) => getText(node, collapsedSource)))
      .toEqual(["[text][]"]);
    const multilineSource = "[text][multi\nline]\n\n[multi line]: /url\n";
    expect(nodes(markdownPhasedParser.parse(multilineSource), "ReferenceLink").map((node) => getText(node, multilineSource)))
      .toEqual(["[text][multi\nline]"]);
  });
});
