import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Parser as CommonMarkParser } from "commonmark";
import { tests } from "commonmark-spec";
import { decodeHTMLStrict } from "entities";
import encode from "mdurl/encode.js";
import { type CstChild, type CstLeaf, type CstNode, getText } from "monogram/cst.ts";
import { afterAll, describe, expect, it } from "vitest";
import { normalizeMarkdownReferenceLabel } from "../packages/satorigear/src/grammar-inline.ts";
import { markdownPhasedParser } from "./support/markdown-phased-parser.ts";

interface SpecCase { markdown: string; section: string }
interface Payload { type: "code" | "html_inline" | "image" | "link"; literal?: string; destination?: string; title?: string }
interface Baseline { version: string; applicable: number; exact: number }

const VERSION = "0.31.2";
const cases = tests as SpecCase[];
const officialParser = new CommonMarkParser();
const baselinePath = fileURLToPath(new URL("./fixtures/commonmark-0.31.2-phased-payload-baseline.json", import.meta.url));
const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as Baseline;
const escapable = /\\([!"#$%&'()*+,./:;<=>?@[\\\]^_`{|}~-])/g;

function semanticText(value: string): string {
  return decodeHTMLStrict(value.replace(escapable, "$1"));
}

function codeLiteral(value: string): string {
  const markerLength = /^`+/.exec(value)![0].length;
  let literal = value.slice(markerLength, -markerLength).replace(/\r\n|\r|\n/g, " ");
  if (literal.startsWith(" ") && literal.endsWith(" ") && /[^ ]/.test(literal)) {
    literal = literal.slice(1, -1);
  }
  return literal;
}

function trimLinkWhitespace(value: string): string {
  return value.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
}

function destinationTitle(bodySource: string): Pick<Payload, "destination" | "title"> {
  const body = trimLinkWhitespace(bodySource);
  if (!body) {
    return { destination: "", title: "" };
  }
  let offset = 0;
  let destination = "";
  if (body[0] === "<") {
    offset = 1;
    while (offset < body.length) {
      if (body[offset] === "\\") {
        offset += 2;
      }
      else if (body[offset] === ">") {
        break;
      }
      else {
        offset++;
      }
    }
    destination = body.slice(1, offset);
    offset++;
  }
  else {
    let depth = 0;
    while (offset < body.length) {
      if (body[offset] === "\\") {
        offset += 2;
      }
      else if (body[offset] === "(") {
        depth++;
        offset++;
      }
      else if (body[offset] === ")") {
        depth--;
        offset++;
      }
      else if (/[ \t\r\n]/.test(body[offset]) && depth === 0) {
        break;
      }
      else {
        offset++;
      }
    }
    destination = body.slice(0, offset);
  }
  const titleSource = trimLinkWhitespace(body.slice(offset));
  const title = titleSource ? titleSource.slice(1, -1) : "";
  return {
    destination: encode(semanticText(destination)),
    title: semanticText(title),
  };
}

function linkPayload(value: string): Pick<Payload, "destination" | "title"> {
  return destinationTitle(value.slice(2, -1));
}

function officialPayloads(root: any): Payload[] {
  const result: Payload[] = [];
  const visit = (node: any): void => {
    if (node.type === "code" || node.type === "html_inline") {
      result.push({ type: node.type, literal: node.literal });
    }
    else if (node.type === "link" || node.type === "image") {
      result.push({ type: node.type, destination: node.destination, title: node.title ?? "" });
    }
    for (let child = node.firstChild; child; child = child.next) {
      visit(child);
    }
  };
  visit(root);
  return result;
}

function directLeaf(node: CstNode, tokenType: string): CstLeaf | undefined {
  return node.children.find((child): child is CstLeaf => "tokenType" in child && child.tokenType === tokenType);
}

function definitionPayloads(root: CstNode, source: string): Map<string, Pick<Payload, "destination" | "title">> {
  const definitions = new Map<string, Pick<Payload, "destination" | "title">>();
  const visit = (node: CstNode): void => {
    if (node.rule === "LinkDefinition") {
      const value = getText(node, source);
      const open = value.indexOf("[");
      let close = open + 1;
      while (close < value.length) {
        if (value[close] === "\\") {
          close += 2;
        }
        else if (value[close] === "]" && value[close + 1] === ":") {
          break;
        }
        else {
          close++;
        }
      }
      const label = normalizeMarkdownReferenceLabel(value.slice(open + 1, close));
      if (!definitions.has(label)) {
        definitions.set(label, destinationTitle(value.slice(close + 2)));
      }
      return;
    }
    for (const child of node.children) {
      if (!("tokenType" in child)) {
        visit(child);
      }
    }
  };
  visit(root);
  return definitions;
}

function referenceLabel(node: CstNode, source: string, image: boolean): string {
  const closeType = image ? "ImageReferenceClose" : "ReferenceClose";
  const close = directLeaf(node, closeType)!;
  const closeText = getText(close, source);
  const value = getText(node, source);
  const content = value.slice(image ? 2 : 1, value.length - closeText.length);
  const explicit = closeText.startsWith("][") ? closeText.slice(2, -1) : "";
  return normalizeMarkdownReferenceLabel(explicit || content);
}

function phasedPayloads(root: CstNode, source: string): { payloads: Payload[]; supported: boolean } {
  const payloads: Payload[] = [];
  const definitions = definitionPayloads(root, source);
  let supported = true;
  const visit = (child: CstChild): void => {
    if ("tokenType" in child) {
      const value = getText(child, source);
      if (child.tokenType === "CodeSpan") {
        payloads.push({ type: "code", literal: codeLiteral(value) });
      }
      else if (child.tokenType === "InlineHtml" || child.tokenType === "HtmlComment") {
        payloads.push({ type: "html_inline", literal: value });
      }
      else if (child.tokenType === "Autolink") {
        const label = value.slice(1, -1);
        payloads.push({
          type: "link",
          destination: encode(label.includes(":") ? label : `mailto:${label}`),
          title: "",
        });
      }
      return;
    }
    if (child.rule === "ReferenceLink") {
      const payload = definitions.get(referenceLabel(child, source, false));
      if (!payload) {
        supported = false;
      }
      else {
        payloads.push({ type: "link", ...payload });
      }
    }
    else if (child.rule === "ReferenceImage" || child.rule === "LinkReferenceImage") {
      const payload = definitions.get(referenceLabel(child, source, true));
      if (!payload) {
        supported = false;
      }
      else {
        payloads.push({ type: "image", ...payload });
      }
    }
    else if (child.rule === "Link" || child.rule === "Image" || child.rule === "LinkImage") {
      const close = directLeaf(child, child.rule === "Link" ? "LinkClose" : "ImageLinkClose");
      if (!close) {
        supported = false;
      }
      else {
        payloads.push({ type: child.rule === "Link" ? "link" : "image", ...linkPayload(getText(close, source)) });
      }
    }
    child.children.forEach(visit);
  };
  root.children.forEach(visit);
  return { payloads, supported };
}

let applicable = 0;
let exact = 0;
const failures: { section: string; markdown: string; expected: Payload[]; actual: Payload[] }[] = [];

for (const test of cases) {
  const source = test.markdown.replace(/→/g, "\t");
  const expected = officialPayloads(officialParser.parse(source));
  const projected = phasedPayloads(markdownPhasedParser.parse(source), source);
  if (!projected.supported || (expected.length === 0 && projected.payloads.length === 0)) {
    continue;
  }
  applicable++;
  if (JSON.stringify(projected.payloads) === JSON.stringify(expected)) {
    exact++;
  }
  else if (failures.length < 20) {
    failures.push({
      section: test.section,
      markdown: source,
      expected,
      actual: projected.payloads,
    });
  }
}

describe("block-first markdown semantic payload gate", () => {
  it("uses the pinned corpus baseline", () => {
    expect(baseline.version).toBe(VERSION);
    expect(applicable).toBeGreaterThanOrEqual(baseline.applicable);
  });

  it("preserves atomic semantic payload compatibility", () => {
    expect(exact).toBeGreaterThanOrEqual(baseline.exact);
  });
});

afterAll(() => {
  console.log(`Block-first Markdown ${VERSION}: ${exact}/${applicable} exact atomic payload projections`);
  for (const failure of failures) {
    console.log(`  [${failure.section}] ${JSON.stringify(failure.markdown)}`);
    console.log(`    expected ${JSON.stringify(failure.expected)}`);
    console.log(`    actual   ${JSON.stringify(failure.actual)}`);
  }
  console.log("##COMMONMARK-PHASED-PAYLOAD## " + JSON.stringify({ version: VERSION, applicable, exact }));
});
