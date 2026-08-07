import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Parser as CommonMarkParser } from "commonmark";
import { tests } from "commonmark-spec";
import { decodeHTMLStrict } from "entities";
import encode from "mdurl/encode.js";
import { afterAll, describe, expect, it } from "vitest";
import { normalizeMarkdownReferenceLabel } from "../packages/satorigear/src/markdown-inline.ts";
import { markdownPhasedParser } from "../packages/satorigear/src/markdown-parser.ts";
import { type CstChild, type CstLeaf, type CstNode, getText } from "../vendors/monogram/src/gen-parser.ts";

interface SpecCase { markdown: string; section: string }
interface SemanticNode {
  type: string;
  literal?: string;
  destination?: string;
  title?: string;
  info?: string | null;
  level?: number;
  listType?: "bullet" | "ordered";
  listStart?: number | null;
  listDelimiter?: string | null;
  listTight?: boolean;
  children?: SemanticNode[];
}
interface Baseline { version: string; total: number; exact: number }
interface Definition { destination: string; title: string }

const VERSION = "0.31.2";
const cases = tests as SpecCase[];
const officialParser = new CommonMarkParser();
const baselinePath = fileURLToPath(new URL("./fixtures/commonmark-0.31.2-phased-semantic-baseline.json", import.meta.url));
const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as Baseline;
const escapable = /\\([!"#$%&'()*+,./:;<=>?@[\\\]^_`{|}~-])/g;

function semanticText(value: string): string {
  return decodeHTMLStrict(value.replace(escapable, "$1"));
}

function node(type: string, children: SemanticNode[] = [], attributes: Omit<SemanticNode, "type" | "children"> = {}): SemanticNode {
  return { type, ...attributes, ...(children.length ? { children } : {}) };
}

function append(target: SemanticNode[], value: SemanticNode): void {
  if (value.type === "text" && !value.literal) return;
  const previous = target.at(-1);
  if (value.type === "softbreak" && previous?.type === "linebreak") return;
  if (value.type === "softbreak" && previous?.type === "text") {
    previous.literal = previous.literal!.replace(/[ \t]+$/, "");
    if (!previous.literal) target.pop();
  }
  if (value.type === "text" && previous?.type === "text") previous.literal += value.literal;
  else target.push(value);
}

function officialTree(value: any): SemanticNode | null {
  const children: SemanticNode[] = [];
  for (let child = value.firstChild; child; child = child.next) {
    const projected = officialTree(child);
    if (projected) append(children, projected);
  }
  switch (value.type) {
    case "document": case "block_quote": case "item": case "paragraph": case "emph": case "strong":
      return node(value.type, children);
    case "list": return node("list", children, {
      listType: value.listType === "ordered" ? "ordered" : "bullet",
      listStart: value.listStart,
      listDelimiter: value.listDelimiter,
      listTight: value.listTight,
    });
    case "heading": return node("heading", children, { level: value.level });
    case "code_block": return node("code_block", [], { literal: value.literal, info: value.info });
    case "html_block": case "text": case "code": case "html_inline":
      return node(value.type, [], { literal: value.literal });
    case "softbreak": case "linebreak": case "thematic_break": return node(value.type);
    case "link": case "image":
      return node(value.type, children, { destination: value.destination, title: value.title ?? "" });
    default: return null;
  }
}

function childNodes(value: CstNode, rule?: string): CstNode[] {
  return value.children.filter((child): child is CstNode => !("tokenType" in child) && (!rule || child.rule === rule));
}

function directLeaf(value: CstNode, tokenType: string): CstLeaf | undefined {
  return value.children.find((child): child is CstLeaf => "tokenType" in child && child.tokenType === tokenType);
}

function descendantLeaves(value: CstNode): CstLeaf[] {
  return value.children.flatMap((child) => ("tokenType" in child ? [child] : descendantLeaves(child)));
}

function payloadStart(value: CstNode): number {
  const offsets = descendantLeaves(value).filter((leaf) => leaf.end > leaf.offset).map((leaf) => leaf.offset);
  return offsets.length ? Math.min(...offsets) : value.end;
}

function payloadEnd(value: CstNode): number {
  const offsets = descendantLeaves(value).filter((leaf) => leaf.end > leaf.offset).map((leaf) => leaf.end);
  return offsets.length ? Math.max(...offsets) : value.offset;
}

function hasBlankLineBetween(source: string, start: number, end: number, stripBlockQuotes: boolean): boolean {
  const lines = normalizeLines(source.slice(Math.max(0, start - 1), end)).split("\n");
  return lines.slice(1, -1).some((line) => {
    if (stripBlockQuotes) {
      while (/^ {0,3}>/.test(line)) line = line.replace(/^ {0,3}>[ \t]?/, "");
    }
    return /^[ \t]*$/.test(line);
  });
}

function listTight(value: CstNode, source: string, itemRule: string): boolean {
  const items = childNodes(value, itemRule);
  for (const item of items) {
    const blocks = childNodes(item, "Block");
    for (let index = 1; index < blocks.length; index++) {
      if (hasBlankLineBetween(source, payloadEnd(blocks[index - 1]), payloadStart(blocks[index]), true)) return false;
    }
  }
  for (let index = 1; index < items.length; index++) {
    if (hasBlankLineBetween(source, payloadEnd(items[index - 1]), payloadStart(items[index]), false)) return false;
  }
  return true;
}

function trimLinkWhitespace(value: string): string {
  return value.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
}

function destinationTitle(bodySource: string): Definition {
  const body = trimLinkWhitespace(bodySource);
  if (!body) return { destination: "", title: "" };
  let offset = 0;
  let destination = "";
  if (body[0] === "<") {
    offset = 1;
    while (offset < body.length) {
      if (body[offset] === "\\") offset += 2;
      else if (body[offset] === ">") break;
      else offset++;
    }
    destination = body.slice(1, offset++);
  }
  else {
    let depth = 0;
    while (offset < body.length) {
      if (body[offset] === "\\") offset += 2;
      else if (body[offset] === "(") {
        depth++;
        offset++;
      }
      else if (body[offset] === ")") {
        depth--;
        offset++;
      }
      else if (/[ \t\r\n]/.test(body[offset]) && depth === 0) break;
      else offset++;
    }
    destination = body.slice(0, offset);
  }
  const titleSource = trimLinkWhitespace(body.slice(offset));
  return {
    destination: encode(semanticText(destination)),
    title: titleSource ? semanticText(titleSource.slice(1, -1)) : "",
  };
}

function definitionsOf(root: CstNode, source: string): Map<string, Definition> {
  const definitions = new Map<string, Definition>();
  const visit = (value: CstNode): void => {
    if (value.rule === "LinkDefinition") {
      const text = getText(value, source);
      const open = text.indexOf("[");
      let close = open + 1;
      while (close < text.length) {
        if (text[close] === "\\") close += 2;
        else if (text[close] === "]" && text[close + 1] === ":") break;
        else close++;
      }
      const label = normalizeMarkdownReferenceLabel(text.slice(open + 1, close));
      if (!definitions.has(label)) definitions.set(label, destinationTitle(text.slice(close + 2)));
      return;
    }
    childNodes(value).forEach(visit);
  };
  visit(root);
  return definitions;
}

function referenceLabel(value: CstNode, source: string, image: boolean): string {
  const close = directLeaf(value, image ? "ImageReferenceClose" : "ReferenceClose")!;
  const closeText = getText(close, source);
  const text = getText(value, source);
  const content = text.slice(image ? 2 : 1, text.length - closeText.length);
  const explicit = closeText.startsWith("][") ? closeText.slice(2, -1) : "";
  return normalizeMarkdownReferenceLabel(explicit || content);
}

function codeLiteral(value: string): string {
  const markerLength = /^`+/.exec(value)![0].length;
  let literal = value.slice(markerLength, -markerLength).replace(/\r\n|\r|\n/g, " ");
  if (literal.startsWith(" ") && literal.endsWith(" ") && /[^ ]/.test(literal)) literal = literal.slice(1, -1);
  return literal;
}

function inlineLeaf(value: CstLeaf, source: string): SemanticNode | null {
  const text = getText(value, source);
  switch (value.tokenType) {
    case "Text": case "Delimiter": case "Escape": case "Entity": case "Strikethrough":
    case "BracketOpen": case "ImageOpen": case "LinkTail": case "ReferenceTail":
    case "ShortcutReferenceTail": case "ReferenceSeparatorClose":
      return node("text", [], { literal: semanticText(text) });
    case "CodeSpan": return node("code", [], { literal: codeLiteral(text) });
    case "InlineHtml": case "HtmlComment": return node("html_inline", [], { literal: text });
    case "Autolink": {
      const label = text.slice(1, -1);
      return node("link", [node("text", [], { literal: label })], {
        destination: encode(label.includes(":") ? label : `mailto:${label}`),
        title: "",
      });
    }
    case "HardBreak": return node("linebreak");
    case "Newline": return node("softbreak");
    default: return null;
  }
}

function projectInlineSequence(
  children: readonly CstChild[],
  source: string,
  definitions: ReadonlyMap<string, Definition>,
  start: number | null = null,
  end: number | null = null,
): SemanticNode[] {
  const result: SemanticNode[] = [];
  let cursor = start;
  for (const child of children) {
    const projected = "tokenType" in child
      ? inlineLeaf(child, source)
      : projectInlineNode(child, source, definitions);
    if (!projected) continue;
    if (cursor !== null && child.offset > cursor) {
      append(result, node("text", [], { literal: semanticText(source.slice(cursor, child.offset).replace(/[\r\n]/g, "")) }));
    }
    if (projected.type === "$sequence") projected.children?.forEach((value) => append(result, value));
    else append(result, projected);
    cursor = child.end;
  }
  if (cursor !== null && end !== null && end > cursor) {
    append(result, node("text", [], { literal: semanticText(source.slice(cursor, end).replace(/[\r\n]/g, "")) }));
  }
  return result;
}

function contentBounds(value: CstNode, openTypes: readonly string[], closeTypes: readonly string[]): [number, number] {
  const open = value.children.find((child): child is CstLeaf => "tokenType" in child && openTypes.includes(child.tokenType));
  const close = value.children.find((child): child is CstLeaf => "tokenType" in child && closeTypes.includes(child.tokenType));
  return [open?.end ?? value.offset, close?.offset ?? value.end];
}

function projectInlineNode(value: CstNode, source: string, definitions: ReadonlyMap<string, Definition>): SemanticNode | null {
  if (value.rule === "InlineLines") {
    const children: SemanticNode[] = [];
    for (const child of value.children) {
      const projected = "tokenType" in child ? inlineLeaf(child, source) : projectInlineNode(child, source, definitions);
      if (projected?.type === "$sequence") projected.children?.forEach((value) => append(children, value));
      else if (projected) append(children, projected);
    }
    return node("$sequence", children);
  }
  if (["InlineLine", "Inline", "LinkContent", "BracketFallback"].includes(value.rule)) {
    return node("$sequence", projectInlineSequence(value.children, source, definitions));
  }
  if (["Emphasis", "LinkEmphasis", "Strong", "LinkStrong"].includes(value.rule)) {
    const [start, end] = contentBounds(value, ["EmphasisOpen", "StrongOpen"], ["EmphasisClose", "StrongClose"]);
    const children = projectInlineSequence(value.children, source, definitions, start, end);
    return node(value.rule.includes("Strong") ? "strong" : "emph", children);
  }
  const image = ["Image", "LinkImage", "ReferenceImage", "LinkReferenceImage"].includes(value.rule);
  const link = value.rule === "Link" || value.rule === "ReferenceLink";
  if (image || link) {
    const reference = value.rule.includes("Reference") || value.rule === "ReferenceLink";
    const openTypes = image ? ["ImageLinkOpen", "ImageReferenceOpen"] : ["LinkOpen", "ReferenceOpen"];
    const closeTypes = image ? ["ImageLinkClose", "ImageReferenceClose"] : ["LinkClose", "ReferenceClose"];
    const [start, end] = contentBounds(value, openTypes, closeTypes);
    const children = projectInlineSequence(value.children, source, definitions, start, end);
    const payload = reference
      ? definitions.get(referenceLabel(value, source, image))!
      : destinationTitle(getText(directLeaf(value, image ? "ImageLinkClose" : "LinkClose")!, source).slice(2, -1));
    return node(image ? "image" : "link", children, payload);
  }
  return node("$sequence", projectInlineSequence(value.children, source, definitions));
}

function inlineChildren(value: CstNode, source: string, definitions: ReadonlyMap<string, Definition>): SemanticNode[] {
  const inline = childNodes(value).find((child) => child.rule === "InlineLines");
  if (!inline) return [];
  const projected = projectInlineNode(inline, source, definitions);
  const result = projected?.children ?? [];
  const last = result.at(-1);
  if (last?.type === "text") {
    last.literal = last.literal!.replace(/[ \t]+$/, "");
    if (!last.literal) result.pop();
  }
  return result;
}

function normalizeLines(value: string): string {
  return value.replace(/\r\n|\r/g, "\n");
}

function fencedPayload(value: string): { literal: string; info: string } {
  const source = normalizeLines(value);
  const lines = source.match(/[^\n]*(?:\n|$)/g)!.filter(Boolean);
  const opening = lines.shift()!;
  let indent = 0;
  while (indent < 3 && opening[indent] === " ") indent++;
  const marker = opening[indent];
  let markerEnd = indent;
  while (opening[markerEnd] === marker) markerEnd++;
  const length = markerEnd - indent;
  if (lines.length && new RegExp(`^ {0,3}\\${marker}{${length},}[ \\t]*(?:\\n|$)`).test(lines.at(-1)!)) lines.pop();
  const literal = lines.map((line) => line.replace(new RegExp(`^ {0,${indent}}`), "").replace(/\n?$/, "\n")).join("");
  return { literal, info: semanticText(opening.slice(markerEnd).trim()) };
}

function removeIndent(value: string, columns: number): string {
  let offset = 0;
  let consumed = 0;
  while (offset < value.length && consumed < columns) {
    if (value[offset] === " ") consumed++;
    else if (value[offset] === "\t") consumed += 4 - (consumed % 4);
    else break;
    offset++;
  }
  return " ".repeat(Math.max(0, consumed - columns)) + value.slice(offset);
}

function indentedLiteral(value: string): string {
  const lines = normalizeLines(value).split("\n").map((line) => removeIndent(line, 4));
  while (lines.length && !lines.at(-1)) lines.pop();
  while (lines.length && /^[ \t]*$/.test(lines.at(-1)!)) lines.pop();
  return lines.length ? `${lines.join("\n")}\n` : "";
}

function firstMappedChild(value: CstNode, source: string, definitions: ReadonlyMap<string, Definition>): SemanticNode | null {
  for (const child of childNodes(value)) {
    const projected = phasedTree(child, source, definitions);
    if (projected) return projected;
  }
  return null;
}

function phasedTree(value: CstNode, source: string, definitions: ReadonlyMap<string, Definition>): SemanticNode | null {
  const blocks = (rule = "Block"): SemanticNode[] => childNodes(value, rule)
    .map((child) => phasedTree(child, source, definitions))
    .filter((child): child is SemanticNode => !!child);
  switch (value.rule) {
    case "Document": return node("document", blocks());
    case "Block": return firstMappedChild(value, source, definitions);
    case "BlockQuote": return node("block_quote", blocks());
    case "UnorderedList": return node("list", childNodes(value, "UnorderedListItem").map((child) => phasedTree(child, source, definitions)!), {
      listType: "bullet",
      listStart: null,
      listDelimiter: null,
      listTight: listTight(value, source, "UnorderedListItem"),
    });
    case "OrderedList": {
      const marker = getText(directLeaf(value, "OrderedListOpen")!, source);
      return node("list", childNodes(value, "OrderedListItem").map((child) => phasedTree(child, source, definitions)!), {
        listType: "ordered",
        listStart: Number.parseInt(marker, 10),
        listDelimiter: marker.at(-1)!,
        listTight: listTight(value, source, "OrderedListItem"),
      });
    }
    case "UnorderedListItem": case "OrderedListItem": return node("item", blocks());
    case "AtxHeading": {
      const marker = directLeaf(value, "AtxHeadingOpen")!;
      return node("heading", inlineChildren(value, source, definitions), { level: marker.end - marker.offset });
    }
    case "SetextHeading": return node("heading", inlineChildren(value, source, definitions), {
      level: directLeaf(value, "SetextHeading1Open") ? 1 : 2,
    });
    case "Paragraph": return node("paragraph", inlineChildren(value, source, definitions));
    case "ThematicBreak": return node("thematic_break");
    case "FencedCode": {
      const payload = fencedPayload(getText(directLeaf(value, "FencedCodeBlock")!, source));
      return node("code_block", [], payload);
    }
    case "IndentedCodeBlock": return node("code_block", [], {
      literal: indentedLiteral(getText(directLeaf(value, "IndentedCodeBlockToken")!, source)),
      info: null,
    });
    case "HtmlBlock": return node("html_block", [], {
      literal: normalizeLines(getText(directLeaf(value, "HtmlBlockToken")!, source)).replace(/\n$/, ""),
    });
    case "LinkDefinition": return null;
    default: return null;
  }
}

let exact = 0;
const bySection = new Map<string, { total: number; exact: number }>();
const failures: { section: string; markdown: string; expected: SemanticNode; actual: SemanticNode | null }[] = [];

for (const test of cases) {
  const source = test.markdown.replace(/→/g, "\t");
  const expected = officialTree(officialParser.parse(source))!;
  const cst = markdownPhasedParser.parse(source);
  const actual = phasedTree(cst, source, definitionsOf(cst, source));
  const section = bySection.get(test.section) ?? { total: 0, exact: 0 };
  bySection.set(test.section, section);
  section.total++;
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    exact++;
    section.exact++;
  }
  else if (failures.length < 30) failures.push({ section: test.section, markdown: source, expected, actual });
}

describe("block-first markdown complete semantic tree gate", () => {
  it("uses the pinned corpus baseline", () => {
    expect(baseline.version).toBe(VERSION);
    expect(baseline.total).toBe(cases.length);
  });

  it("preserves complete semantic tree compatibility", () => {
    expect(exact).toBeGreaterThanOrEqual(baseline.exact);
  });
});

afterAll(() => {
  console.log(`Block-first Markdown ${VERSION}: ${exact}/${cases.length} exact complete semantic trees`);
  for (const [section, counts] of bySection) console.log(`  ${section.padEnd(40)} ${String(counts.exact).padStart(3)}/${counts.total}`);
  console.log("\nFirst semantic tree divergences:");
  for (const failure of failures) {
    console.log(`  [${failure.section}] ${JSON.stringify(failure.markdown)}`);
    console.log(`    expected ${JSON.stringify(failure.expected)}`);
    console.log(`    actual   ${JSON.stringify(failure.actual)}`);
  }
  console.log("##COMMONMARK-PHASED-SEMANTIC## " + JSON.stringify({ version: VERSION, total: cases.length, exact }));
});
