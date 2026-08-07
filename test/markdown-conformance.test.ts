// CommonMark 0.31.2 official-corpus structural conformance harness.
//
// The spec corpus contains only valid documents, so accept/reject agreement would be a vacuous
// metric. Instead, this compares Monogram's semantic CST projection with commonmark.js's reference
// AST on every official example, at three levels:
//   • blockExact  — container/leaf block tree (inline contents erased)
//   • inlineExact — document-wide inline event sequence
//   • fullExact   — combined normalized semantic tree
//
// Run: pnpm conformance:markdown
// The committed baseline is a regression floor, not a claim of conformance. Raise it whenever a
// feature lands; never lower it without documenting why.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Parser as CommonMarkParser } from "commonmark";
import { tests } from "commonmark-spec";
import { afterAll, describe, expect, it } from "vitest";
import grammar from "../packages/satorigear/src/markdown.ts";
import { createParser, type CstChild, type CstNode, getText } from "../vendors/monogram/src/gen-parser.ts";

interface SpecCase { markdown: string; section: string; number: number }
interface Sem { type: string; attr?: string; children?: Sem[] }
interface Counts { total: number; accepted: number; blockExact: number; inlineExact: number; fullExact: number }
interface Baseline extends Counts { version: string }

const VERSION = "0.31.2";
const cases = tests as SpecCase[];
const officialParser = new CommonMarkParser();
const { parse } = createParser(grammar);
const baselinePath = fileURLToPath(new URL("./fixtures/commonmark-0.31.2-baseline.json", import.meta.url));
const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as Baseline;
let currentSource = "";

// The spec source renders tabs visibly as U+2192. The official test runner converts these arrows
// to tabs before invoking an implementation; expected HTML retains the visible form.
const sourceOf = (t: SpecCase): string => t.markdown.replace(/→/g, "\t");

function childrenOf(node: any): any[] {
  const out: any[] = [];
  for (let child = node.firstChild; child; child = child.next) out.push(child);
  return out;
}

function officialSem(node: any): Sem | null {
  const children = childrenOf(node).map(officialSem).filter((x): x is Sem => x !== null);
  switch (node.type) {
    case "document": return sem("document", children);
    case "block_quote": return sem("block_quote", children);
    case "list": return sem("list", children, node.listType === "ordered" ? "ordered" : "bullet");
    case "item": return sem("item", children);
    case "heading": return sem("heading", children, String(node.level));
    case "code_block": return sem("code_block");
    case "html_block": return sem("html_block");
    case "thematic_break": return sem("thematic_break");
    case "paragraph": return sem("paragraph", children);
    case "text": return sem("text");
    case "softbreak": return sem("softbreak");
    case "linebreak": return sem("linebreak");
    case "code": return sem("code");
    case "html_inline": return sem("html_inline");
    case "emph": return sem("emph", children);
    case "strong": return sem("strong", children);
    case "link": return sem("link", children);
    case "image": return sem("image", children);
    // Link-reference definitions are intentionally absent from commonmark.js's public AST.
    default: return children.length ? sem(node.type, children) : sem(node.type);
  }
}

function sem(type: string, children: Sem[] = [], attr?: string): Sem {
  const normalized = normalizeChildren(children);
  return {
    type,
    ...(typeof attr === "string" ? { attr } : {}),
    ...(normalized.length ? { children: normalized } : {}),
  };
}

function normalizeChildren(children: Sem[]): Sem[] {
  const out: Sem[] = [];
  for (const child of children) {
    const normalized = sem(child.type, child.children ?? [], child.attr);
    // Literal chunk boundaries are implementation details. Adjacent text leaves are one semantic
    // text run for comparison purposes.
    if (normalized.type === "text" && out.at(-1)?.type === "text") continue;
    out.push(normalized);
  }
  return out;
}

function nodesNamed(node: CstNode, rule: string): CstNode[] {
  return node.children.filter((c): c is CstNode => "rule" in c && c.rule === rule);
}

function leaves(node: CstNode): Extract<CstChild, { tokenType: string }>[] {
  const out: Extract<CstChild, { tokenType: string }>[] = [];
  const visit = (child: CstChild): void => {
    if ("tokenType" in child) out.push(child);
    else child.children.forEach(visit);
  };
  node.children.forEach(visit);
  return out;
}

function inlineFromLeaf(leaf: Extract<CstChild, { tokenType: string }>): Sem | null {
  const textChild = () => sem("text");
  switch (leaf.tokenType) {
    case "CodeSpan": return sem("code");
    case "Emphasis": return sem("emph", [textChild()]);
    case "Strong": return sem("strong", [textChild()]);
    case "Link": case "ReferenceLink": case "Autolink": return sem("link", [textChild()]);
    case "Image": return sem("image", [textChild()]);
    case "InlineHtml": case "HtmlComment": return sem("html_inline");
    case "HardBreak": return sem("linebreak");
    case "Text": case "Delimiter": case "Escape": case "Entity": case "Strikethrough":
    case "SetextUnderline": return textChild();
    default: return null;
  }
}

function inlineChildren(node: CstNode, preserveTrailingBreak = false): Sem[] {
  const inlineLeaves = leaves(node);
  return normalizeChildren(inlineLeaves.map((leaf, index) => {
    if (leaf.tokenType === "HardBreak" && index === inlineLeaves.length - 1 && !preserveTrailingBreak) {
      // A break marker only becomes a linebreak when inline content continues on the next physical
      // line. A final backslash is literal text; final spaces disappear from the semantic stream.
      return getText(leaf, currentSource) === "\\" ? sem("text") : null;
    }
    return inlineFromLeaf(leaf);
  }).filter((x): x is Sem => x !== null));
}

// InlineLines is left-recursive in the CST, so its physical line boundaries are represented by
// nested InlineLines nodes rather than a flat list. Stop recursion at each InlineLine to avoid
// visiting its inline descendants twice, and insert the CommonMark softbreak event between lines.
function inlineLinesChildren(node: CstNode): Sem[] {
  const lines: CstNode[] = [];
  const collect = (current: CstNode): void => {
    if (current.rule === "InlineLine") {
      lines.push(current);
      return;
    }
    for (const child of current.children) if ("rule" in child) collect(child);
  };
  collect(node);
  const children: Sem[] = [];
  lines.forEach((line, index) => {
    if (index && children.at(-1)?.type !== "linebreak") children.push(sem("softbreak"));
    children.push(...inlineChildren(line, index < lines.length - 1));
  });
  return normalizeChildren(children);
}

function monoSem(node: CstNode): Sem | null {
  switch (node.rule) {
    case "Document": {
      const blocks = nodesNamed(node, "Block").map(monoSem).filter((x): x is Sem => x !== null);
      return sem("document", blocks);
    }
    case "Block": {
      for (const child of node.children) {
        if ("tokenType" in child) {
          if (child.tokenType === "ThematicBreak" || child.tokenType === "DashThematicBreak") return sem("thematic_break");
          if (child.tokenType === "LinkDefinition") return null;
          continue;
        }
        const mapped = monoSem(child);
        if (mapped) return mapped;
      }
      return null;
    }
    case "AtxHeading": {
      const markerLeaf = leaves(node).find((l) => l.tokenType === "AtxHeadingMarker");
      const marker = markerLeaf ? getText(markerLeaf, currentSource) : "#";
      return sem("heading", inlineChildren(node), String(marker.length));
    }
    case "SetextHeading": {
      const underlineLeaf = leaves(node).find((l) => l.tokenType === "SetextUnderline" || l.tokenType === "DashThematicBreak" || l.tokenType === "EmptyDashMarker");
      const underline = underlineLeaf ? getText(underlineLeaf, currentSource) : "-";
      return sem("heading", inlineLinesChildren(node), underline.trimStart().startsWith("=") ? "1" : "2");
    }
    case "Paragraph": {
      const lines = inlineLinesChildren(node);
      return sem("paragraph", lines.length ? lines : inlineChildren(node));
    }
    case "FencedCode": case "IndentedCodeBlock": return sem("code_block");
    case "HtmlBlock": return sem("html_block");
    case "BlockQuote": {
      const lines = nodesNamed(node, "BlockQuoteLine");
      const content: Sem[] = [];
      lines.forEach((line, i) => {
        if (i && content.at(-1)?.type !== "linebreak") content.push(sem("softbreak"));
        content.push(...inlineChildren(line, i < lines.length - 1));
      });
      return sem("block_quote", [sem("paragraph", content)]);
    }
    case "UnorderedList": case "OrderedList": {
      const itemRule = node.rule === "UnorderedList" ? "UnorderedListItem" : "OrderedListItem";
      const items = nodesNamed(node, itemRule).map((item) => sem("item", [sem("paragraph", inlineChildren(item))]));
      return sem("list", items, node.rule === "OrderedList" ? "ordered" : "bullet");
    }
    default: return null;
  }
}

const BLOCK_TYPES = new Set(["document", "block_quote", "list", "item", "heading", "code_block", "html_block", "thematic_break", "paragraph"]);
const isBlockNode = (node: Sem): boolean => BLOCK_TYPES.has(node.type);

function blockShape(node: Sem): Sem {
  const isInlineContainer = node.type === "paragraph" || node.type === "heading";
  return sem(node.type, isInlineContainer ? [] : (node.children ?? []).filter(isBlockNode).map(blockShape), node.attr);
}

function inlineEvents(node: Sem, out: string[] = []): string[] {
  if (!isBlockNode(node)) out.push(node.type);
  for (const child of node.children ?? []) inlineEvents(child, out);
  return out;
}

const counts: Counts = { total: cases.length, accepted: 0, blockExact: 0, inlineExact: 0, fullExact: 0 };
const bySection = new Map<string, Counts>();
const failures: { number: number; section: string; kind: string; markdown: string }[] = [];
for (const test of cases) {
  const source = sourceOf(test);
  currentSource = source;
  const officialAst = officialParser.parse(source);
  const expected = officialSem(officialAst)!;
  const section = bySection.get(test.section) ?? { total: 0, accepted: 0, blockExact: 0, inlineExact: 0, fullExact: 0 };
  bySection.set(test.section, section);
  section.total++;

  let actual: Sem | null = null;
  try {
    actual = monoSem(parse(source));
  }
  catch { /* recorded as a parse failure below */ }
  if (!actual) {
    if (failures.length < 20) failures.push({ number: test.number, section: test.section, kind: "parse", markdown: source });
    continue;
  }
  counts.accepted++; section.accepted++;
  const block = JSON.stringify(blockShape(actual)) === JSON.stringify(blockShape(expected));
  const inline = JSON.stringify(inlineEvents(actual)) === JSON.stringify(inlineEvents(expected));
  const full = JSON.stringify(actual) === JSON.stringify(expected);
  if (block) {
    counts.blockExact++; section.blockExact++;
  }
  if (inline) {
    counts.inlineExact++; section.inlineExact++;
  }
  if (full) {
    counts.fullExact++; section.fullExact++;
  }
  if (!full && failures.length < 20) failures.push({ number: test.number, section: test.section, kind: block ? "inline" : "block", markdown: source });
}

const pct = (n: number, total = counts.total): string => `${(100 * n / total).toFixed(1)}%`;

describe(`CommonMark ${VERSION} official corpus`, () => {
  it("uses a baseline for the current corpus", () => {
    expect(baseline.version).toBe(VERSION);
    expect(baseline.total).toBe(cases.length);
  });

  for (const key of ["accepted", "blockExact", "inlineExact", "fullExact"] as const) {
    it(`preserves the ${key} baseline`, () => {
      expect(counts[key]).toBeGreaterThanOrEqual(baseline[key]);
    });
  }
});

afterAll(() => {
  console.log(`CommonMark ${VERSION}: ${counts.total} official examples`);
  console.log(`  accepted    ${counts.accepted}/${counts.total} (${pct(counts.accepted)})`);
  console.log(`  block exact ${counts.blockExact}/${counts.total} (${pct(counts.blockExact)})`);
  console.log(`  inline exact ${counts.inlineExact}/${counts.total} (${pct(counts.inlineExact)})`);
  console.log(`  full exact  ${counts.fullExact}/${counts.total} (${pct(counts.fullExact)})`);
  console.log("\nBy section:");
  for (const [name, c] of bySection) {
    console.log(`  ${name.padEnd(40)} ${String(c.fullExact).padStart(3)}/${String(c.total).padEnd(3)} full · ${String(c.blockExact).padStart(3)} block · ${String(c.inlineExact).padStart(3)} inline`);
  }
  console.log("\nFirst divergences:");
  for (const f of failures) {
    const sample = JSON.stringify(f.markdown.length > 70 ? f.markdown.slice(0, 67) + "..." : f.markdown);
    console.log(`  #${f.number} [${f.section}] ${f.kind}: ${sample}`);
  }
  console.log("##COMMONMARK## " + JSON.stringify({ version: VERSION, ...counts }));
  console.log("\n✓ CommonMark official-corpus baseline preserved");
});
