import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Parser as CommonMarkParser } from "commonmark";
import { tests } from "commonmark-spec";
import { afterAll, describe, expect, it } from "vitest";
import { markdownPhasedParser } from "../packages/satorigear/src/markdown-parser.ts";
import type { CstNode } from "../vendors/monogram/src/gen-parser.ts";

interface SpecCase { markdown: string; section: string }
interface Shape { type: string; attr?: string; children?: Shape[] }
interface Baseline { version: string; total: number; accepted: number; blockExact: number }

const VERSION = "0.31.2";
const cases = tests as SpecCase[];
const officialParser = new CommonMarkParser();
const baselinePath = fileURLToPath(new URL("./fixtures/commonmark-0.31.2-phased-baseline.json", import.meta.url));
const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as Baseline;

function shape(type: string, children: Shape[] = [], attr?: string): Shape {
  return {
    type,
    ...(typeof attr === "string" ? { attr } : {}),
    ...(children.length ? { children } : {}),
  };
}

function officialShape(node: any): Shape | null {
  const children: Shape[] = [];
  for (let child = node.firstChild; child; child = child.next) {
    const mapped = officialShape(child);
    if (mapped) children.push(mapped);
  }
  switch (node.type) {
    case "document": return shape("document", children);
    case "block_quote": return shape("block_quote", children);
    case "list": return shape("list", children, node.listType === "ordered" ? "ordered" : "bullet");
    case "item": return shape("item", children);
    case "heading": return shape("heading", [], String(node.level));
    case "code_block": return shape("code_block");
    case "html_block": return shape("html_block");
    case "thematic_break": return shape("thematic_break");
    case "paragraph": return shape("paragraph");
    default: return null;
  }
}

function childNodes(node: CstNode, rule?: string): CstNode[] {
  return node.children.filter((child): child is CstNode => !("tokenType" in child) && (!rule || child.rule === rule));
}

function firstMappedChild(node: CstNode): Shape | null {
  for (const child of childNodes(node)) {
    const mapped = phasedShape(child);
    if (mapped) return mapped;
  }
  return null;
}

function itemShape(node: CstNode): Shape {
  return shape("item", childNodes(node, "Block").map(phasedShape).filter((value): value is Shape => value !== null));
}

function phasedShape(node: CstNode): Shape | null {
  switch (node.rule) {
    case "Document": return shape("document", childNodes(node, "Block").map(phasedShape).filter((value): value is Shape => value !== null));
    case "Block": return firstMappedChild(node);
    case "BlockQuote": return shape("block_quote", childNodes(node, "Block").map(phasedShape).filter((value): value is Shape => value !== null));
    case "UnorderedList": return shape("list", childNodes(node, "UnorderedListItem").map(itemShape), "bullet");
    case "OrderedList": return shape("list", childNodes(node, "OrderedListItem").map(itemShape), "ordered");
    case "AtxHeading": {
      const marker = node.children.find((child) => "tokenType" in child && child.tokenType === "AtxHeadingOpen");
      return shape("heading", [], marker && "tokenType" in marker ? String(marker.end - marker.offset) : "1");
    }
    case "SetextHeading": {
      const marker = node.children.find((child) => "tokenType" in child
        && (child.tokenType === "SetextHeading1Open" || child.tokenType === "SetextHeading2Open"));
      return shape("heading", [], marker && "tokenType" in marker && marker.tokenType === "SetextHeading1Open" ? "1" : "2");
    }
    case "Paragraph": return shape("paragraph");
    case "FencedCode": case "IndentedCodeBlock": return shape("code_block");
    case "HtmlBlock": return shape("html_block");
    case "ThematicBreak": return shape("thematic_break");
    default: return null;
  }
}

let accepted = 0;
let blockExact = 0;
const bySection = new Map<string, { total: number; exact: number }>();
const failures: { section: string; markdown: string }[] = [];

for (const test of cases) {
  const source = test.markdown.replace(/→/g, "\t");
  const expected = officialShape(officialParser.parse(source))!;
  const section = bySection.get(test.section) ?? { total: 0, exact: 0 };
  bySection.set(test.section, section);
  section.total++;
  try {
    const actual = phasedShape(markdownPhasedParser.parse(source));
    accepted++;
    if (JSON.stringify(actual) === JSON.stringify(expected)) {
      blockExact++;
      section.exact++;
    }
    else if (failures.length < 30) failures.push({ section: test.section, markdown: source });
  }
  catch { /* counted by the accepted baseline */ }
}

describe("block-first markdown official corpus shadow gate", () => {
  it("uses the pinned corpus baseline", () => {
    expect(baseline.version).toBe(VERSION);
    expect(baseline.total).toBe(cases.length);
  });

  it("preserves parser completion", () => {
    expect(accepted).toBeGreaterThanOrEqual(baseline.accepted);
  });

  it("preserves exact block structure", () => {
    expect(blockExact).toBeGreaterThanOrEqual(baseline.blockExact);
  });
});

afterAll(() => {
  console.log(`Block-first Markdown ${VERSION}: ${blockExact}/${cases.length} exact blocks; ${accepted}/${cases.length} parsed`);
  for (const [section, counts] of bySection) {
    console.log(`  ${section.padEnd(40)} ${String(counts.exact).padStart(3)}/${counts.total}`);
  }
  console.log("\nFirst block divergences:");
  for (const failure of failures) {
    console.log(`  [${failure.section}] ${JSON.stringify(failure.markdown)}`);
  }
  console.log("##COMMONMARK-PHASED## " + JSON.stringify({ version: VERSION, total: cases.length, accepted, blockExact }));
});
