import { decodeHTMLStrict } from "entities";
import type {
  BlockContent,
  Blockquote,
  Code,
  Definition,
  DefinitionContent,
  Emphasis,
  Heading,
  Html,
  Image,
  ImageReference,
  InlineCode,
  Link,
  LinkReference,
  List,
  ListItem,
  Paragraph,
  PhrasingContent,
  Root,
  Strong,
} from "mdast";
import { normalizeMarkdownReferenceLabel } from "./grammar-inline.ts";
import type { SyntaxTreeLeaf, SyntaxTreeNode } from "./emitted-parser.ts";

interface Resource {
  url: string;
  title: string | null;
}

interface Reference {
  identifier: string;
  label: string;
  referenceType: "collapsed" | "full" | "shortcut";
}

interface SourceSpan {
  end: number;
  start: number;
}

export interface SourcePoint {
  column: number;
  line: number;
  offset: number;
}

interface SpanContext {
  source: string;
  spans: Map<object, SourceSpan>;
}

interface ProjectionContext extends SpanContext {
  syntax: MarkdownSyntax;
}

export type MarkdownSyntaxNode = SyntaxTreeNode;
export type MarkdownSyntaxLeaf = SyntaxTreeLeaf;
export type MarkdownSyntaxChild = MarkdownSyntaxLeaf | MarkdownSyntaxNode;

export interface MarkdownSyntax {
  children: (node: MarkdownSyntaxNode) => readonly MarkdownSyntaxChild[];
  inline: (node: MarkdownSyntaxNode) => MarkdownSyntaxNode | undefined;
  isLeaf: (child: MarkdownSyntaxChild) => child is MarkdownSyntaxLeaf;
  ranges: (leaf: MarkdownSyntaxLeaf) => readonly { end: number; offset: number }[] | undefined;
  rule: (node: MarkdownSyntaxNode) => string;
  span: (value: MarkdownSyntaxChild) => SourceSpan;
  text: (value: MarkdownSyntaxChild) => string;
  tokenType: (leaf: MarkdownSyntaxLeaf) => string;
}

export interface MdastBlockFragment {
  node: BlockContent | DefinitionContent;
  spans: Map<object, SourceSpan>;
}

interface FragmentValue {
  children?: FragmentValue[];
}

interface MaterializedValue extends FragmentValue {
  children?: MaterializedValue[];
  position: { end: SourcePoint; start: SourcePoint };
}

function withSpan<const T extends object>(context: SpanContext, value: T, start: number, end: number): T {
  context.spans.set(value, { start, end });
  return value;
}

function spanOf(context: SpanContext, value: object): SourceSpan {
  const span = context.spans.get(value);
  if (!span) {
    throw new Error("mdast node is missing its syntax source span");
  }
  return span;
}

function extendSpan(context: SpanContext, value: object, end: number): void {
  const span = spanOf(context, value);
  span.end = Math.max(span.end, end);
}

function blockEnd(value: MarkdownSyntaxNode, context: ProjectionContext): number {
  const span = context.syntax.span(value);
  let end = span.end;
  if (end > span.start && context.source[end - 1] === "\n") {
    end--;
  }
  if (end > span.start && context.source[end - 1] === "\r") {
    end--;
  }
  return end;
}

function lineStart(source: string, offset: number): number {
  const lineFeed = source.lastIndexOf("\n", Math.max(0, offset - 1));
  const carriageReturn = source.lastIndexOf("\r", Math.max(0, offset - 1));
  return Math.max(lineFeed, carriageReturn) + 1;
}

function lineEnd(source: string, offset: number): number {
  const ending = /[\r\n]/.exec(source.slice(offset));
  return ending ? offset + ending.index : source.length;
}

function lineEndingStart(source: string, offset: number): number {
  const start = lineStart(source, offset);
  if (start === 0) {
    return offset;
  }
  return source[start - 1] === "\n" && source[start - 2] === "\r" ? start - 2 : start - 1;
}

function firstChildStart(context: SpanContext, value: { children: readonly object[] }): number {
  const first = value.children[0];
  if (!first) {
    throw new Error("mdast container unexpectedly has no children");
  }
  return spanOf(context, first).start;
}

function lastChildEnd(context: SpanContext, value: { children: readonly object[] }, emptyEnd: number): number {
  const last = value.children.at(-1);
  return last ? spanOf(context, last).end : emptyEnd;
}

function firstNonspace(source: string, start: number, end: number): number {
  while (start < end && (source[start] === " " || source[start] === "\t")) {
    start++;
  }
  return start;
}

function indentedCodeEnd(value: MarkdownSyntaxNode, context: ProjectionContext): number {
  const token = leaf(value, "IndentedCodeBlockToken", context);
  const tokenSpan = context.syntax.span(token);
  const ranges = context.syntax.ranges(token) ?? [{ offset: tokenSpan.start, end: tokenSpan.end }];
  // Blank indented lines belong to the block; the bare separator newline after them does not.
  for (let index = ranges.length - 1; index >= 0; index--) {
    const range = ranges[index];
    if (/[^\r\n]/.test(context.source.slice(range.offset, range.end))) {
      let end = range.end;
      while (end > range.offset && /[\r\n]/.test(context.source[end - 1])) {
        end--;
      }
      return end;
    }
  }
  throw new Error("IndentedCodeBlockToken has no source content");
}

function createPoint(source: string): (offset: number) => SourcePoint {
  const starts = [0];
  for (let offset = 0; offset < source.length; offset++) {
    if (source[offset] === "\n") {
      starts.push(offset + 1);
    }
    else if (source[offset] === "\r" && source[offset + 1] !== "\n") {
      starts.push(offset + 1);
    }
  }
  return (offset) => {
    let low = 0;
    let high = starts.length;
    while (low + 1 < high) {
      const middle = (low + high) >>> 1;
      if (starts[middle] <= offset) {
        low = middle;
      }
      else {
        high = middle;
      }
    }
    return { line: low + 1, column: offset - starts[low] + 1, offset };
  };
}

const semanticCharacter = /\\([!"#$%&'()*+,./:;<=>?@[\\\]^_`{|}~-])|&(?:#x[\da-f]{1,6}|#\d{1,7}|[a-z][\da-z]{1,31});/gi;

function semanticText(value: string): string {
  return value.replace(semanticCharacter, (match, escaped) => escaped ?? decodeHTMLStrict(match));
}

function identifier(value: string): string {
  return normalizeMarkdownReferenceLabel(value).toLowerCase();
}

function childNodes(value: MarkdownSyntaxNode, rule: string | null, context: ProjectionContext): MarkdownSyntaxNode[] {
  return context.syntax.children(value).filter((child): child is MarkdownSyntaxNode => (
    !context.syntax.isLeaf(child) && (!rule || context.syntax.rule(child) === rule)
  ));
}

function directLeaf(
  value: MarkdownSyntaxNode,
  tokenType: string,
  context: ProjectionContext,
): MarkdownSyntaxLeaf | undefined {
  return context.syntax.children(value).find((child): child is MarkdownSyntaxLeaf => (
    context.syntax.isLeaf(child) && context.syntax.tokenType(child) === tokenType
  ));
}

function leaf(value: MarkdownSyntaxNode, tokenType: string, context: ProjectionContext): MarkdownSyntaxLeaf {
  const result = directLeaf(value, tokenType, context);
  if (!result) {
    throw new Error(`Expected ${context.syntax.rule(value)} syntax to contain ${tokenType}`);
  }
  return result;
}

function leafOfTypes(
  value: MarkdownSyntaxNode,
  tokenTypes: readonly string[],
  context: ProjectionContext,
): MarkdownSyntaxLeaf {
  const result = context.syntax.children(value).find((child): child is MarkdownSyntaxLeaf => (
    context.syntax.isLeaf(child) && tokenTypes.includes(context.syntax.tokenType(child))
  ));
  if (!result) {
    throw new Error(`Expected ${context.syntax.rule(value)} syntax to contain one of: ${tokenTypes.join(", ")}`);
  }
  return result;
}

function descendantLeaves(value: MarkdownSyntaxNode, context: ProjectionContext): MarkdownSyntaxLeaf[] {
  return context.syntax.children(value).flatMap((child) => (
    context.syntax.isLeaf(child) ? [child] : descendantLeaves(child, context)
  ));
}

function payloadStart(value: MarkdownSyntaxNode, context: ProjectionContext): number {
  const offsets = descendantLeaves(value, context)
    .map((leaf) => context.syntax.span(leaf))
    .filter((span) => span.end > span.start)
    .map((span) => span.start);
  return offsets.length ? Math.min(...offsets) : context.syntax.span(value).end;
}

function payloadEnd(value: MarkdownSyntaxNode, context: ProjectionContext): number {
  const offsets = descendantLeaves(value, context)
    .map((leaf) => context.syntax.span(leaf))
    .filter((span) => span.end > span.start)
    .map((span) => span.end);
  return offsets.length ? Math.max(...offsets) : context.syntax.span(value).start;
}

function normalizeLines(value: string): string {
  return value.replace(/\r\n|\r/g, "\n");
}

function hasBlankLineBetween(source: string, start: number, end: number, stripBlockQuotes: boolean): boolean {
  const lines = normalizeLines(source.slice(Math.max(0, start - 1), end)).split("\n");
  return lines.slice(1, -1).some((line) => {
    if (stripBlockQuotes) {
      while (/^ {0,3}>/.test(line)) {
        line = line.replace(/^ {0,3}>[ \t]?/, "");
      }
    }
    return /^[ \t]*$/.test(line);
  });
}

function listItemSpread(value: MarkdownSyntaxNode, context: ProjectionContext): boolean {
  const blocks = childNodes(value, "Block", context);
  for (let index = 1; index < blocks.length; index++) {
    if (hasBlankLineBetween(context.source, payloadEnd(blocks[index - 1], context), payloadStart(blocks[index], context), true)) {
      return true;
    }
  }
  return false;
}

function listSpread(items: readonly MarkdownSyntaxNode[], context: ProjectionContext): boolean {
  for (let index = 1; index < items.length; index++) {
    if (hasBlankLineBetween(context.source, payloadEnd(items[index - 1], context), payloadStart(items[index], context), false)) {
      return true;
    }
  }
  return false;
}

function trimLinkWhitespace(value: string): string {
  return value.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
}

function destinationTitle(bodySource: string): Resource {
  const body = trimLinkWhitespace(bodySource);
  if (!body) {
    return { url: "", title: null };
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
    destination = body.slice(1, offset++);
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
  return {
    url: semanticText(destination),
    title: titleSource ? semanticText(titleSource.slice(1, -1)) : null,
  };
}

function definition(value: MarkdownSyntaxNode, context: ProjectionContext): Definition {
  const text = context.syntax.text(value);
  const span = context.syntax.span(value);
  const open = text.indexOf("[");
  let close = open + 1;
  while (close < text.length) {
    if (text[close] === "\\") {
      close += 2;
    }
    else if (text[close] === "]" && text[close + 1] === ":") {
      break;
    }
    else {
      close++;
    }
  }
  const labelSource = text.slice(open + 1, close);
  return withSpan(context, {
    type: "definition",
    identifier: identifier(labelSource),
    label: semanticText(labelSource),
    ...destinationTitle(text.slice(close + 2)),
  }, span.start + open, blockEnd(value, context));
}

function codeSpanValue(value: string): string {
  const markerLength = /^`+/.exec(value)?.[0].length;
  if (!markerLength) {
    throw new Error("CodeSpan token does not start with a backtick run");
  }
  let result = normalizeLines(value.slice(markerLength, -markerLength));
  if (/^[ \n]/.test(result) && /[ \n]$/.test(result) && /[^ \n]/.test(result)) {
    result = result.slice(1, -1);
  }
  return result;
}

function appendText(context: ProjectionContext, target: PhrasingContent[], value: string, start: number, end: number): void {
  if (!value) {
    return;
  }
  const previous = target.at(-1);
  if (previous?.type === "text") {
    previous.value += value;
    extendSpan(context, previous, end);
  }
  else {
    target.push(withSpan(context, { type: "text", value }, start, end));
  }
}

function appendPhrasing(context: ProjectionContext, target: PhrasingContent[], value: PhrasingContent): void {
  if (value.type === "text") {
    const span = spanOf(context, value);
    appendText(context, target, value.value, span.start, span.end);
  }
  else {
    target.push(value);
  }
}

function inlineLeaf(value: MarkdownSyntaxLeaf, context: ProjectionContext): PhrasingContent | undefined {
  const text = context.syntax.text(value);
  const span = context.syntax.span(value);
  switch (context.syntax.tokenType(value)) {
    case "Text":
    case "Delimiter":
    case "Escape":
    case "Entity":
    case "Strikethrough":
    case "BracketOpen":
    case "ImageOpen":
    case "LinkTail":
    case "ReferenceTail":
    case "ShortcutReferenceTail":
    case "ReferenceSeparatorClose":
      return withSpan(context, { type: "text", value: semanticText(text) }, span.start, span.end);
    case "CodeSpan": return withSpan(context, { type: "inlineCode", value: codeSpanValue(text) } satisfies InlineCode, span.start, span.end);
    case "InlineHtml":
    case "HtmlComment": return withSpan(context, { type: "html", value: text } satisfies Html, span.start, span.end);
    case "HardBreak": return withSpan(context, { type: "break" }, span.start, span.end);
    case "Newline": return withSpan(context, { type: "text", value: "\n" }, span.start, span.end);
    case "EmphasisOpen":
    case "EmphasisClose":
    case "StrongOpen":
    case "StrongClose":
    case "LinkOpen":
    case "LinkClose":
    case "ReferenceOpen":
    case "ReferenceClose":
    case "ImageLinkOpen":
    case "ImageLinkClose":
    case "ImageReferenceOpen":
    case "ImageReferenceClose":
      return;
    case "Autolink": {
      const label = text.slice(1, -1);
      return withSpan(context, {
        type: "link",
        url: label.includes(":") ? label : `mailto:${label}`,
        title: null,
        children: [withSpan(context, { type: "text", value: label }, span.start + 1, span.end - 1)],
      } satisfies Link, span.start, span.end);
    }
    default: throw new Error(`Unexpected inline token: ${context.syntax.tokenType(value)}`);
  }
}

function contentBounds(
  value: MarkdownSyntaxNode,
  openTypes: readonly string[],
  closeTypes: readonly string[],
  context: ProjectionContext,
): [number, number] {
  return [
    context.syntax.span(leafOfTypes(value, openTypes, context)).end,
    context.syntax.span(leafOfTypes(value, closeTypes, context)).start,
  ];
}

function appendInlineValue(
  context: ProjectionContext,
  target: PhrasingContent[],
  value: PhrasingContent[] | PhrasingContent,
  nextLineOffset: number,
): void {
  const first = Array.isArray(value) ? value[0] : value;
  if (first?.type === "text" && first.value.startsWith("\n")) {
    // Composite syntax newlines point past stripped container prefixes, while mdast spans include the physical line ending.
    const previous = target.at(-1);
    if (!Array.isArray(value) && previous?.type === "break") {
      extendSpan(context, previous, lineStart(context.source, nextLineOffset));
      return;
    }
    spanOf(context, first).start = lineEndingStart(context.source, nextLineOffset);
    if (previous?.type === "text") {
      previous.value = previous.value.replace(/[ \t]+$/, "");
    }
  }
  if (Array.isArray(value)) {
    value.forEach((child) => appendPhrasing(context, target, child));
  }
  else {
    appendPhrasing(context, target, value);
  }
}

function inlineSequence(
  children: readonly MarkdownSyntaxChild[],
  context: ProjectionContext,
  start: number | null = null,
  end: number | null = null,
): PhrasingContent[] {
  const { source } = context;
  const result: PhrasingContent[] = [];
  let cursor = start;
  for (const child of children) {
    const projected = context.syntax.isLeaf(child) ? inlineLeaf(child, context) : inlineNode(child, context);
    if (!projected) {
      continue;
    }
    const span = context.syntax.span(child);
    if (cursor !== null && span.start > cursor) {
      appendText(context, result, semanticText(source.slice(cursor, span.start).replace(/[\r\n]/g, "")), cursor, span.start);
    }
    appendInlineValue(context, result, projected, span.start);
    cursor = span.end;
  }
  if (cursor !== null && end !== null && end > cursor) {
    appendText(context, result, semanticText(source.slice(cursor, end).replace(/[\r\n]/g, "")), cursor, end);
  }
  return result;
}

function reference(value: MarkdownSyntaxNode, context: ProjectionContext, image: boolean): Reference {
  const close = leaf(value, image ? "ImageReferenceClose" : "ReferenceClose", context);
  const closeText = context.syntax.text(close);
  const text = context.syntax.text(value);
  const content = text.slice(image ? 2 : 1, text.length - closeText.length);
  const full = closeText.startsWith("][") && closeText !== "][]";
  const labelSource = full ? closeText.slice(2, -1) : content;
  return {
    identifier: identifier(labelSource),
    label: semanticText(labelSource),
    referenceType: full ? "full" : closeText === "][]" ? "collapsed" : "shortcut",
  };
}

function phrasingText(children: readonly PhrasingContent[]): string {
  let result = "";
  for (const child of children) {
    if (child.type === "text" || child.type === "inlineCode" || child.type === "html") {
      result += child.value;
    }
    else if (child.type === "break") {
      result += "\n";
    }
    else if ("children" in child) {
      result += phrasingText(child.children);
    }
    else if (child.type === "image" || child.type === "imageReference") {
      result += child.alt ?? "";
    }
  }
  return result;
}

function inlineLines(value: MarkdownSyntaxNode, context: ProjectionContext): PhrasingContent[] {
  const children: PhrasingContent[] = [];
  for (const child of context.syntax.children(value)) {
    const projected = context.syntax.isLeaf(child) ? inlineLeaf(child, context) : inlineNode(child, context);
    if (!projected) {
      continue;
    }
    appendInlineValue(context, children, projected, context.syntax.span(child).start);
  }
  return children;
}

function emphasis(value: MarkdownSyntaxNode, context: ProjectionContext, kind: "emphasis" | "strong"): Emphasis | Strong {
  const marker = kind === "strong" ? "Strong" : "Emphasis";
  const [start, end] = contentBounds(value, [`${marker}Open`], [`${marker}Close`], context);
  const children = inlineSequence(context.syntax.children(value), context, start, end);
  const span = context.syntax.span(value);
  return kind === "strong"
    ? withSpan(context, { type: "strong", children } satisfies Strong, span.start, span.end)
    : withSpan(context, { type: "emphasis", children } satisfies Emphasis, span.start, span.end);
}

function linkOrImage(
  value: MarkdownSyntaxNode,
  context: ProjectionContext,
  media: "image" | "link",
  resourceKind: "direct" | "reference",
): Image | ImageReference | Link | LinkReference {
  const image = media === "image";
  const referenceNode = resourceKind === "reference";
  const prefix = image ? "Image" : "";
  const resourcePrefix = referenceNode ? "Reference" : "Link";
  const [start, end] = contentBounds(value, [`${prefix}${resourcePrefix}Open`], [`${prefix}${resourcePrefix}Close`], context);
  const children = inlineSequence(context.syntax.children(value), context, start, end);
  const span = context.syntax.span(value);
  if (referenceNode) {
    const association = reference(value, context, image);
    return image
      ? withSpan(context, { type: "imageReference", alt: phrasingText(children), ...association } satisfies ImageReference, span.start, span.end)
      : withSpan(context, { type: "linkReference", children, ...association } satisfies LinkReference, span.start, span.end);
  }
  const resource = destinationTitle(context.syntax.text(leaf(value, `${prefix}LinkClose`, context)).slice(2, -1));
  return image
    ? withSpan(context, { type: "image", alt: phrasingText(children), ...resource } satisfies Image, span.start, span.end)
    : withSpan(context, { type: "link", children, ...resource } satisfies Link, span.start, span.end);
}

function inlineNode(value: MarkdownSyntaxNode, context: ProjectionContext): PhrasingContent[] | PhrasingContent {
  switch (context.syntax.rule(value)) {
    case "InlineLines": return inlineLines(value, context);
    case "InlineLine":
    case "Inline":
    case "LinkContent":
    case "BracketFallback":
      return inlineSequence(context.syntax.children(value), context);
    case "Emphasis":
    case "LinkEmphasis": return emphasis(value, context, "emphasis");
    case "Strong":
    case "LinkStrong": return emphasis(value, context, "strong");
    case "Image":
    case "LinkImage": return linkOrImage(value, context, "image", "direct");
    case "ReferenceImage":
    case "LinkReferenceImage": return linkOrImage(value, context, "image", "reference");
    case "Link": return linkOrImage(value, context, "link", "direct");
    case "ReferenceLink": return linkOrImage(value, context, "link", "reference");
    default: throw new Error(`Unexpected inline syntax rule: ${context.syntax.rule(value)}`);
  }
}

function inlineChildren(value: MarkdownSyntaxNode, context: ProjectionContext): PhrasingContent[] {
  const inline = context.syntax.inline(value);
  if (!inline) {
    if (context.syntax.rule(value) === "AtxHeading") {
      return [];
    }
    throw new Error(`Expected ${context.syntax.rule(value)} syntax to contain InlineLines`);
  }
  const result = inlineLines(inline, context);
  const last = result.at(-1);
  if (last?.type === "text") {
    const trimmed = last.value.replace(/[ \t]+$/, "");
    const removed = last.value.length - trimmed.length;
    last.value = trimmed;
    spanOf(context, last).end -= removed;
    if (!last.value) {
      result.pop();
    }
  }
  return result;
}

function fencedCode(value: string): { closed: boolean; node: Code } {
  const source = normalizeLines(value);
  const lines = source.match(/[^\n]*(?:\n|$)/g)?.filter(Boolean);
  if (!lines?.length) {
    throw new Error("FencedCodeBlock token is empty");
  }
  const opening = lines[0];
  const contentLines = lines.slice(1);
  let indent = 0;
  while (indent < 3 && opening[indent] === " ") {
    indent++;
  }
  const marker = opening[indent];
  if (marker !== "`" && marker !== "~") {
    throw new Error("FencedCodeBlock token has no opening fence");
  }
  let markerEnd = indent;
  while (opening[markerEnd] === marker) {
    markerEnd++;
  }
  const markerLength = markerEnd - indent;
  const closing = contentLines.at(-1);
  const closed = Boolean(closing && new RegExp(`^ {0,3}\\${marker}{${markerLength},}[ \\t]*(?:\\n|$)`).test(closing));
  if (closed) {
    contentLines.pop();
  }
  const literal = contentLines.map((line) => line.replace(new RegExp(`^ {0,${indent}}`), "").replace(/\n?$/, "\n")).join("");
  const rawInfo = semanticText(opening.slice(markerEnd).replace(/^[ \t]+/, "").replace(/\n$/, ""));
  const langEnd = rawInfo.search(/[ \t]/);
  const lang = rawInfo ? langEnd < 0 ? rawInfo : rawInfo.slice(0, langEnd) : null;
  const metaStart = langEnd < 0 ? -1 : rawInfo.slice(langEnd).search(/[^ \t]/);
  return {
    closed,
    node: {
      type: "code",
      lang,
      meta: metaStart < 0 ? null : rawInfo.slice(langEnd + metaStart),
      value: literal.replace(/\n$/, ""),
    },
  };
}

function removeIndent(value: string, columns: number): string {
  let offset = 0;
  let consumed = 0;
  while (offset < value.length && consumed < columns) {
    if (value[offset] === " ") {
      consumed++;
    }
    else if (value[offset] === "\t") {
      consumed += 4 - (consumed % 4);
    }
    else {
      break;
    }
    offset++;
  }
  return " ".repeat(Math.max(0, consumed - columns)) + value.slice(offset);
}

function indentedCode(value: string): Code {
  const lines = normalizeLines(value).split("\n").map((line) => removeIndent(line, 4));
  while (lines.length) {
    if (!/^[ \t]*$/.test(lines[lines.length - 1])) {
      break;
    }
    lines.pop();
  }
  return { type: "code", lang: null, meta: null, value: lines.join("\n") };
}

function htmlBlockValue(value: string): string {
  const source = normalizeLines(value);
  const lower = source.toLowerCase();
  let terminator: string | null = null;
  const tag = /^ {0,3}<(script|pre|style|textarea)(?:[ \t\n>]|$)/i.exec(source)?.[1];
  if (tag) {
    terminator = `</${tag.toLowerCase()}>`;
  }
  else if (/^ {0,3}<!--/.test(source)) {
    terminator = "-->";
  }
  else if (/^ {0,3}<\?/.test(source)) {
    terminator = "?>";
  }
  else if (/^ {0,3}<!\[cdata\[/i.test(source)) {
    terminator = "]]>";
  }
  else if (/^ {0,3}<![A-Z]/.test(source)) {
    terminator = ">";
  }
  return terminator && !lower.includes(terminator) ? source : source.replace(/\n$/, "");
}

function blockContent(value: MarkdownSyntaxNode, context: ProjectionContext): BlockContent | DefinitionContent {
  if (context.syntax.rule(value) !== "Block") {
    throw new Error(`Expected Block syntax, received ${context.syntax.rule(value)}`);
  }
  const children = childNodes(value, null, context);
  if (children.length !== 1) {
    throw new Error(`Expected Block syntax to contain one node, received ${children.length}`);
  }
  return blockNode(children[0], context);
}

function listItem(value: MarkdownSyntaxNode, context: ProjectionContext): ListItem {
  const rule = context.syntax.rule(value);
  if (rule !== "OrderedListItem" && rule !== "UnorderedListItem") {
    throw new Error(`Expected list item syntax, received ${rule}`);
  }
  const marker = leaf(value, rule === "OrderedListItem" ? "OrderedItemOpen" : "UnorderedItemOpen", context);
  const markerSpan = context.syntax.span(marker);
  const result = {
    type: "listItem",
    spread: listItemSpread(value, context),
    checked: null,
    children: childNodes(value, "Block", context).map((child) => blockContent(child, context)),
  } satisfies ListItem;
  return withSpan(context, result, markerSpan.start, lastChildEnd(context, result, blockEnd(value, context)));
}

function blockNode(value: MarkdownSyntaxNode, context: ProjectionContext): BlockContent | DefinitionContent {
  const { source } = context;
  const span = context.syntax.span(value);
  const rule = context.syntax.rule(value);
  switch (rule) {
    case "BlockQuote": {
      const result = {
        type: "blockquote",
        children: childNodes(value, "Block", context).map((child) => blockContent(child, context)),
      } satisfies Blockquote;
      const marker = context.syntax.span(leaf(value, "BlockQuoteOpen", context));
      const start = firstNonspace(source, marker.start, lineEnd(source, span.start));
      return withSpan(context, result, start, blockEnd(value, context));
    }
    case "UnorderedList":
    case "OrderedList": {
      const ordered = rule === "OrderedList";
      const itemRule = ordered ? "OrderedListItem" : "UnorderedListItem";
      const items = childNodes(value, itemRule, context);
      const listMarker = leaf(value, ordered ? "OrderedListOpen" : "UnorderedListOpen", context);
      const markerSpan = context.syntax.span(listMarker);
      const result = {
        type: "list",
        ordered,
        start: ordered ? Number.parseInt(context.syntax.text(listMarker), 10) : null,
        spread: listSpread(items, context),
        children: items.map((item) => listItem(item, context)),
      } satisfies List;
      return withSpan(context, result, markerSpan.start, lastChildEnd(context, result, markerSpan.end));
    }
    case "AtxHeading": {
      const marker = context.syntax.span(leaf(value, "AtxHeadingOpen", context));
      return withSpan(context, {
        type: "heading",
        depth: marker.end - marker.start as Heading["depth"],
        children: inlineChildren(value, context),
      } satisfies Heading, marker.start, blockEnd(value, context));
    }
    case "SetextHeading": {
      const levelOne = directLeaf(value, "SetextHeading1Open", context);
      if (!levelOne) {
        leaf(value, "SetextHeading2Open", context);
      }
      const result = {
        type: "heading",
        depth: levelOne ? 1 : 2,
        children: inlineChildren(value, context),
      } satisfies Heading;
      return withSpan(
        context,
        result,
        firstChildStart(context, result),
        context.syntax.span(leaf(value, "HeadingClose", context)).start,
      );
    }
    case "Paragraph": {
      const result = { type: "paragraph", children: inlineChildren(value, context) } satisfies Paragraph;
      return withSpan(context, result, firstChildStart(context, result), blockEnd(value, context));
    }
    case "ThematicBreak": return withSpan(
      context,
      { type: "thematicBreak" },
      firstNonspace(source, span.start, span.end),
      blockEnd(value, context),
    );
    case "FencedCode": {
      const fence = fencedCode(context.syntax.text(leaf(value, "FencedCodeBlock", context)));
      // An unclosed fence owns the final newline only when it reaches the document's EOF.
      const end = fence.closed || span.end < source.length ? blockEnd(value, context) : span.end;
      return withSpan(context, fence.node, firstNonspace(source, span.start, lineEnd(source, span.start)), end);
    }
    case "IndentedCodeBlock": return withSpan(
      context,
      indentedCode(context.syntax.text(leaf(value, "IndentedCodeBlockToken", context))),
      span.start,
      indentedCodeEnd(value, context),
    );
    case "HtmlBlock": {
      const html = htmlBlockValue(context.syntax.text(leaf(value, "HtmlBlockToken", context)));
      return withSpan(context, { type: "html", value: html } satisfies Html, span.start, html.endsWith("\n") ? span.end : blockEnd(value, context));
    }
    case "LinkDefinition": return definition(value, context);
    default: throw new Error(`Unexpected block syntax rule: ${rule}`);
  }
}

export function markdownSyntaxBlockToMdastFragment(
  tree: MarkdownSyntaxNode,
  source: string,
  syntax: MarkdownSyntax,
): MdastBlockFragment {
  const context = { source, syntax, spans: new Map<object, SourceSpan>() };
  const node = blockContent(tree, context);
  const offset = syntax.span(tree).start;
  for (const span of context.spans.values()) {
    span.start -= offset;
    span.end -= offset;
  }
  return { node, spans: context.spans };
}

function materializeFragment(
  fragment: MdastBlockFragment,
  offset: number,
  point: (offset: number) => SourcePoint,
): BlockContent | DefinitionContent {
  const clone = (value: FragmentValue): MaterializedValue => {
    const span = fragment.spans.get(value);
    if (!span) {
      throw new Error("mdast fragment node is missing its relative source span");
    }
    const result = {
      ...value,
      position: {
        start: point(offset + span.start),
        end: point(offset + span.end),
      },
    } as MaterializedValue;
    if (value.children) {
      result.children = value.children.map(clone);
    }
    return result;
  };
  return clone(fragment.node as FragmentValue) as BlockContent | DefinitionContent;
}

export function markdownFragmentsToMdast(
  fragments: readonly { fragment: MdastBlockFragment; offset: number }[],
  source: string,
  point?: (offset: number) => SourcePoint,
): Root {
  const locate = point ?? createPoint(source);
  return {
    type: "root",
    children: fragments.map(({ fragment, offset }) => materializeFragment(fragment, offset, locate)),
    position: { start: locate(0), end: locate(source.length) },
  } satisfies Root;
}
