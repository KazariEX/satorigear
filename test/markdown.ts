// Markdown parser/lexer regression checks.
// Run with: pnpm test:markdown
import grammar from "../packages/satorigear/src/markdown.ts";
import { createLexer } from "../vendors/monogram/src/gen-lexer.ts";
import { createParser, type CstNode } from "../vendors/monogram/src/gen-parser.ts";

const { tokenize } = createLexer(grammar);
const { parse } = createParser(grammar);
let passed = 0;

function check(label: string, condition: boolean): void {
  if (!condition) throw new Error(`markdown: ${label}`);
  passed++;
}

function types(source: string): string[] {
  return tokenize(source).map((t) => t.type);
}

function rules(node: CstNode): string[] {
  const out: string[] = [];
  const visit = (value: CstNode): void => {
    out.push(value.rule);
    for (const child of value.children) if ("rule" in child) visit(child);
  };
  visit(node);
  return out;
}

const representative = `# Heading *emphasis*

Paragraph with **strong**, [a link](https://example.com), and \`code\`.

> quote
- item
1. ordered
---
Setext
======

\`\`\`ts
const smaller = 1 < 2;
# this stays code
\`\`\`

    indented code
`;

const ts = types(representative);
for (const expected of [
  "AtxHeadingMarker",
  "Emphasis",
  "Strong",
  "Link",
  "CodeSpan",
  "BlockQuoteMarker",
  "UnorderedListMarker",
  "OrderedListMarker",
  "DashThematicBreak",
  "SetextUnderline",
  "FenceBlock",
  "IndentedCode",
]) check(`lexes ${expected}`, ts.includes(expected));

check("fenced body is opaque", ts.filter((t) => t === "AtxHeadingMarker").length === 1);
check("an inline hash is text, not a heading", !types("value # still text").includes("AtxHeadingMarker"));
check("a line-start hash after <=3 spaces is a heading", types("   ## heading")[0] === "AtxHeadingMarker");
check("four leading spaces form indented code", types("    ## code")[0] === "IndentedCode");
check("a leading tab advances to an indented code column", types("\t## code")[0] === "IndentedCode");
check("thematic break wins over list marker", types("* * *")[0] === "ThematicBreak");
check("dash thematic break wins over list marker", types("- - -")[0] === "DashThematicBreak");
check("ordinary star marker remains a list item", types("* item")[0] === "UnorderedListMarker");
check("an empty bullet remains a list item", rules(parse("-")).includes("UnorderedListItem"));
check("an empty ordered marker remains a list item", rules(parse("1.")).includes("OrderedListItem"));
check("same-line backticks are inline code, not a fence", types("```inline```")[0] === "CodeSpan");

const longFence = tokenize("````js\nbody\n```\n# swallowed");
check("a shorter closing fence does not close the block", longFence.length === 1 && longFence[0].type === "FenceBlock");
const tildeFence = tokenize("~~~js\nbody\n~~~~\n# heading");
check("a longer same-marker fence closes the block", tildeFence.some((t) => t.type === "AtxHeadingMarker"));
const crlfFence = tokenize("```\r\nbody\r\n```\r\n# heading");
check("a CRLF closing fence returns control to the next block", crlfFence.some((t) => t.type === "AtxHeadingMarker"));
const crFence = tokenize("```\rbody\r```\r# heading");
check("a CR closing fence returns control to the next block", crFence.some((t) => t.type === "AtxHeadingMarker"));

const tree = parse(representative);
const rs = rules(tree);
check("parser returns Document", tree.rule === "Document");
for (const expected of [
  "AtxHeading",
  "Paragraph",
  "BlockQuote",
  "UnorderedListItem",
  "OrderedListItem",
  "UnorderedList",
  "OrderedList",
  "SetextHeading",
  "FencedCode",
  "IndentedCodeBlock",
]) check(`parser builds ${expected}`, rs.includes(expected));

// Markdown is intentionally error-tolerant: unmatched delimiters are literal punctuation.
check("unmatched inline delimiters remain parseable", parse("plain * unmatched [ text").rule === "Document");
check("empty input is a document", parse("").rule === "Document");
check("dash underline forms a setext heading contextually", rules(parse("Heading\n---")).includes("SetextHeading"));
check("single-dash underline forms a setext heading contextually", rules(parse("Heading\n-")).includes("SetextHeading"));
check("adjacent inline lines form one paragraph", rules(parse("first\nsecond")).filter((r) => r === "Paragraph").length === 1);
check("multi-line setext content forms one heading", rules(parse("first\nsecond\n===")).filter((r) => r === "SetextHeading").length === 1);

console.log(`${passed}/${passed} markdown checks pass`);
