import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Parser as CommonMarkParser } from "commonmark";
import { tests } from "commonmark-spec";
import { afterAll, describe, expect, it } from "vitest";
import { markdownPhasedParser } from "../packages/satorigear/src/markdown-parser.ts";
import type { CstChild, CstNode } from "../vendors/monogram/src/gen-parser.ts";

interface SpecCase { markdown: string; section: string }
interface Baseline { version: string; total: number; accepted: number; inlineProjectionExact: number }

const VERSION = "0.31.2";
const cases = tests as SpecCase[];
const officialParser = new CommonMarkParser();
const baselinePath = fileURLToPath(new URL("./fixtures/commonmark-0.31.2-phased-inline-baseline.json", import.meta.url));
const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as Baseline;
const blockTypes = new Set([
  "document",
  "block_quote",
  "list",
  "item",
  "heading",
  "code_block",
  "html_block",
  "thematic_break",
  "paragraph",
]);
const inlineTypes = new Set(["text", "softbreak", "linebreak", "code", "html_inline", "emph", "strong", "link", "image"]);
const leafEvents: Record<string, string[]> = {
  CodeSpan: ["code"],
  Emphasis: ["emph", "text"],
  Strong: ["strong", "text"],
  Link: ["link", "text"],
  ReferenceCandidate: ["link", "text"],
  Autolink: ["link", "text"],
  Image: ["image", "text"],
  InlineHtml: ["html_inline"],
  HtmlComment: ["html_inline"],
  HardBreak: ["linebreak"],
  Text: ["text"],
  Delimiter: ["text"],
  Escape: ["text"],
  Entity: ["text"],
  Strikethrough: ["text"],
  Newline: ["softbreak"],
};

function normalize(events: readonly string[]): string[] {
  const result: string[] = [];
  for (const event of events) {
    if (event === "text" && result.at(-1) === "text") continue;
    result.push(event);
  }
  return result;
}

function officialEvents(root: any): string[] {
  const events: string[] = [];
  const visit = (node: any): void => {
    if (!blockTypes.has(node.type) && inlineTypes.has(node.type)) events.push(node.type);
    for (let child = node.firstChild; child; child = child.next) visit(child);
  };
  visit(root);
  return normalize(events);
}

function phasedEvents(root: CstNode): string[] {
  const events: string[] = [];
  const visit = (child: CstChild): void => {
    if ("tokenType" in child) {
      for (const event of leafEvents[child.tokenType] ?? []) {
        if (event !== "softbreak" || events.at(-1) !== "linebreak") events.push(event);
      }
      return;
    }
    child.children.forEach(visit);
  };
  root.children.forEach(visit);
  return normalize(events);
}

let accepted = 0;
let inlineProjectionExact = 0;
const bySection = new Map<string, { total: number; exact: number }>();
const failures: { section: string; markdown: string; expected: string[]; actual: string[] }[] = [];

for (const test of cases) {
  const source = test.markdown.replace(/→/g, "\t");
  const expected = officialEvents(officialParser.parse(source));
  const section = bySection.get(test.section) ?? { total: 0, exact: 0 };
  bySection.set(test.section, section);
  section.total++;
  try {
    const actual = phasedEvents(markdownPhasedParser.parse(source));
    accepted++;
    if (JSON.stringify(actual) === JSON.stringify(expected)) {
      inlineProjectionExact++;
      section.exact++;
    }
    else if (failures.length < 30) failures.push({ section: test.section, markdown: source, expected, actual });
  }
  catch { /* counted by the accepted baseline */ }
}

describe("block-first markdown inline CST projection gate", () => {
  it("uses the pinned corpus baseline", () => {
    expect(baseline.version).toBe(VERSION);
    expect(baseline.total).toBe(cases.length);
  });

  it("preserves parser completion", () => {
    expect(accepted).toBeGreaterThanOrEqual(baseline.accepted);
  });

  it("preserves the inline projection baseline", () => {
    expect(inlineProjectionExact).toBeGreaterThanOrEqual(baseline.inlineProjectionExact);
  });
});

afterAll(() => {
  console.log(`Block-first Markdown ${VERSION}: ${inlineProjectionExact}/${cases.length} exact inline projections; ${accepted}/${cases.length} parsed`);
  for (const [section, counts] of bySection) {
    console.log(`  ${section.padEnd(40)} ${String(counts.exact).padStart(3)}/${counts.total}`);
  }
  console.log("\nFirst inline projection divergences:");
  for (const failure of failures) {
    console.log(`  [${failure.section}] ${JSON.stringify(failure.markdown)}`);
    console.log(`    expected ${JSON.stringify(failure.expected)}`);
    console.log(`    actual   ${JSON.stringify(failure.actual)}`);
  }
  console.log("##COMMONMARK-PHASED-INLINE## " + JSON.stringify({
    version: VERSION,
    total: cases.length,
    accepted,
    inlineProjectionExact,
  }));
});
