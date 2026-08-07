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
  RootContent,
  Strong,
  Text,
} from "mdast";
import { type CstChild, type CstLeaf, type CstNode, getText } from "../../../vendors/monogram/src/gen-parser.ts";
import { normalizeMarkdownReferenceLabel } from "./grammar-inline.ts";
import { markdownPhasedParser } from "./parser.ts";

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

interface SourcePoint {
  column: number;
  line: number;
  offset: number;
}

interface ProjectionContext {
  source: string;
  spans: WeakMap<object, SourceSpan>;
}

interface PositionedValue {
  children?: PositionedValue[];
  position?: { end: SourcePoint; start: SourcePoint };
}

function withSpan<const T extends object>(context: ProjectionContext, value: T, start: number, end: number): T {
  context.spans.set(value, { start, end });
  return value;
}

function spanOf(context: ProjectionContext, value: object): SourceSpan {
  const span = context.spans.get(value);
  if (!span) throw new Error("mdast node is missing its CST source span");
  return span;
}

function extendSpan(context: ProjectionContext, value: object, end: number): void {
  const span = spanOf(context, value);
  span.end = Math.max(span.end, end);
}

function blockEnd(value: CstNode, source: string): number {
  let end = value.end;
  if (end > value.offset && source[end - 1] === "\n") end--;
  if (end > value.offset && source[end - 1] === "\r") end--;
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
  if (start === 0) return offset;
  return source[start - 1] === "\n" && source[start - 2] === "\r" ? start - 2 : start - 1;
}

function firstChildStart(context: ProjectionContext, value: { children: readonly object[] }): number {
  const first = value.children[0];
  if (!first) throw new Error("mdast container unexpectedly has no children");
  return spanOf(context, first).start;
}

function lastChildEnd(context: ProjectionContext, value: { children: readonly object[] }, emptyEnd: number): number {
  const last = value.children.at(-1);
  return last ? spanOf(context, last).end : emptyEnd;
}

function firstNonspace(source: string, start: number, end: number): number {
  while (start < end && (source[start] === " " || source[start] === "\t")) start++;
  return start;
}

function indentedCodeEnd(value: CstNode, source: string): number {
  const token = leaf(value, "IndentedCodeBlockToken");
  const ranges = token.ranges ?? [{ offset: token.offset, end: token.end }];
  // Blank indented lines belong to the block; the bare separator newline after them does not.
  for (let index = ranges.length - 1; index >= 0; index--) {
    const range = ranges[index];
    if (/[^\r\n]/.test(source.slice(range.offset, range.end))) {
      let end = range.end;
      while (end > range.offset && /[\r\n]/.test(source[end - 1])) end--;
      return end;
    }
  }
  throw new Error("IndentedCodeBlockToken has no source content");
}

function attachPositions(context: ProjectionContext, root: Root): Root {
  const { source } = context;
  const starts = [0];
  for (let offset = 0; offset < source.length; offset++) {
    if (source[offset] === "\n") starts.push(offset + 1);
    else if (source[offset] === "\r" && source[offset + 1] !== "\n") starts.push(offset + 1);
  }
  const point = (offset: number): SourcePoint => {
    let low = 0;
    let high = starts.length;
    while (low + 1 < high) {
      const middle = (low + high) >>> 1;
      if (starts[middle] <= offset) low = middle;
      else high = middle;
    }
    return { line: low + 1, column: offset - starts[low] + 1, offset };
  };
  const visit = (value: PositionedValue): void => {
    const span = spanOf(context, value);
    value.position = { start: point(span.start), end: point(span.end) };
    value.children?.forEach(visit);
  };
  visit(root as PositionedValue);
  return root;
}

const escapable = /\\([!"#$%&'()*+,./:;<=>?@[\\\]^_`{|}~-])/g;

function semanticText(value: string): string {
  return decodeHTMLStrict(value.replace(escapable, "$1"));
}

function identifier(value: string): string {
  return normalizeMarkdownReferenceLabel(value).toLowerCase();
}

function childNodes(value: CstNode, rule?: string): CstNode[] {
  return value.children.filter((child): child is CstNode => !("tokenType" in child) && (!rule || child.rule === rule));
}

function directLeaf(value: CstNode, tokenType: string): CstLeaf | undefined {
  return value.children.find((child): child is CstLeaf => "tokenType" in child && child.tokenType === tokenType);
}

function leaf(value: CstNode, tokenType: string): CstLeaf {
  const result = directLeaf(value, tokenType);
  if (!result) throw new Error(`Expected ${value.rule} CST to contain ${tokenType}`);
  return result;
}

function leafOfTypes(value: CstNode, tokenTypes: readonly string[]): CstLeaf {
  const result = value.children.find((child): child is CstLeaf => "tokenType" in child && tokenTypes.includes(child.tokenType));
  if (!result) throw new Error(`Expected ${value.rule} CST to contain one of: ${tokenTypes.join(", ")}`);
  return result;
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

function normalizeLines(value: string): string {
  return value.replace(/\r\n|\r/g, "\n");
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

function listItemSpread(value: CstNode, source: string): boolean {
  const blocks = childNodes(value, "Block");
  for (let index = 1; index < blocks.length; index++) {
    if (hasBlankLineBetween(source, payloadEnd(blocks[index - 1]), payloadStart(blocks[index]), true)) return true;
  }
  return false;
}

function listSpread(items: readonly CstNode[], source: string): boolean {
  for (let index = 1; index < items.length; index++) {
    if (hasBlankLineBetween(source, payloadEnd(items[index - 1]), payloadStart(items[index]), false)) return true;
  }
  return false;
}

function trimLinkWhitespace(value: string): string {
  return value.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
}

function destinationTitle(bodySource: string): Resource {
  const body = trimLinkWhitespace(bodySource);
  if (!body) return { url: "", title: null };
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
    url: semanticText(destination),
    title: titleSource ? semanticText(titleSource.slice(1, -1)) : null,
  };
}

function definition(value: CstNode, context: ProjectionContext): Definition {
  const { source } = context;
  const text = getText(value, source);
  const open = text.indexOf("[");
  let close = open + 1;
  while (close < text.length) {
    if (text[close] === "\\") close += 2;
    else if (text[close] === "]" && text[close + 1] === ":") break;
    else close++;
  }
  const labelSource = text.slice(open + 1, close);
  return withSpan(context, {
    type: "definition",
    identifier: identifier(labelSource),
    label: semanticText(labelSource),
    ...destinationTitle(text.slice(close + 2)),
  }, value.offset + open, blockEnd(value, source));
}

function codeSpanValue(value: string): string {
  const markerLength = /^`+/.exec(value)?.[0].length;
  if (!markerLength) throw new Error("CodeSpan token does not start with a backtick run");
  let result = normalizeLines(value.slice(markerLength, -markerLength));
  if (/^[ \n]/.test(result) && /[ \n]$/.test(result) && /[^ \n]/.test(result)) result = result.slice(1, -1);
  return result;
}

function appendText(context: ProjectionContext, target: PhrasingContent[], value: string, start: number, end: number): void {
  if (!value) return;
  const previous = target.at(-1);
  if (previous?.type === "text") {
    previous.value += value;
    extendSpan(context, previous, end);
  }
  else target.push(withSpan(context, { type: "text", value }, start, end));
}

function appendPhrasing(context: ProjectionContext, target: PhrasingContent[], value: PhrasingContent): void {
  if (value.type === "text") {
    const span = spanOf(context, value);
    appendText(context, target, value.value, span.start, span.end);
  }
  else target.push(value);
}

function inlineLeaf(value: CstLeaf, context: ProjectionContext): PhrasingContent | undefined {
  const { source } = context;
  const text = getText(value, source);
  switch (value.tokenType) {
    case "Text": case "Delimiter": case "Escape": case "Entity": case "Strikethrough":
    case "BracketOpen": case "ImageOpen": case "LinkTail": case "ReferenceTail":
    case "ShortcutReferenceTail": case "ReferenceSeparatorClose":
      return withSpan(context, { type: "text", value: semanticText(text) }, value.offset, value.end);
    case "CodeSpan": return withSpan(context, { type: "inlineCode", value: codeSpanValue(text) } satisfies InlineCode, value.offset, value.end);
    case "InlineHtml": case "HtmlComment": return withSpan(context, { type: "html", value: text } satisfies Html, value.offset, value.end);
    case "HardBreak": return withSpan(context, { type: "break" }, value.offset, value.end);
    case "Newline": return withSpan(context, { type: "text", value: "\n" }, value.offset, value.end);
    case "EmphasisOpen": case "EmphasisClose": case "StrongOpen": case "StrongClose":
    case "LinkOpen": case "LinkClose": case "ReferenceOpen": case "ReferenceClose":
    case "ImageLinkOpen": case "ImageLinkClose": case "ImageReferenceOpen": case "ImageReferenceClose":
      return;
    case "Autolink": {
      const label = text.slice(1, -1);
      return withSpan(context, {
        type: "link",
        url: label.includes(":") ? label : `mailto:${label}`,
        title: null,
        children: [withSpan(context, { type: "text", value: label }, value.offset + 1, value.end - 1)],
      } satisfies Link, value.offset, value.end);
    }
    default: throw new Error(`Unexpected inline token: ${value.tokenType}`);
  }
}

function contentBounds(value: CstNode, openTypes: readonly string[], closeTypes: readonly string[]): [number, number] {
  return [leafOfTypes(value, openTypes).end, leafOfTypes(value, closeTypes).offset];
}

function appendInlineValue(
  context: ProjectionContext,
  target: PhrasingContent[],
  value: PhrasingContent[] | PhrasingContent,
  nextLineOffset: number,
): void {
  const first = Array.isArray(value) ? value[0] : value;
  if (first?.type === "text" && first.value.startsWith("\n")) {
    // Composite CST newlines point past stripped container prefixes, while mdast spans include the physical line ending.
    const previous = target.at(-1);
    if (!Array.isArray(value) && previous?.type === "break") {
      extendSpan(context, previous, lineStart(context.source, nextLineOffset));
      return;
    }
    spanOf(context, first).start = lineEndingStart(context.source, nextLineOffset);
    if (previous?.type === "text") previous.value = previous.value.replace(/[ \t]+$/, "");
  }
  if (Array.isArray(value)) value.forEach((child) => appendPhrasing(context, target, child));
  else appendPhrasing(context, target, value);
}

function inlineSequence(
  children: readonly CstChild[],
  context: ProjectionContext,
  start: number | null = null,
  end: number | null = null,
): PhrasingContent[] {
  const { source } = context;
  const result: PhrasingContent[] = [];
  let cursor = start;
  for (const child of children) {
    const projected = "tokenType" in child ? inlineLeaf(child, context) : inlineNode(child, context);
    if (!projected) continue;
    if (cursor !== null && child.offset > cursor) {
      appendText(context, result, semanticText(source.slice(cursor, child.offset).replace(/[\r\n]/g, "")), cursor, child.offset);
    }
    appendInlineValue(context, result, projected, child.offset);
    cursor = child.end;
  }
  if (cursor !== null && end !== null && end > cursor) {
    appendText(context, result, semanticText(source.slice(cursor, end).replace(/[\r\n]/g, "")), cursor, end);
  }
  return result;
}

function reference(value: CstNode, context: ProjectionContext, image: boolean): Reference {
  const { source } = context;
  const close = leaf(value, image ? "ImageReferenceClose" : "ReferenceClose");
  const closeText = getText(close, source);
  const text = getText(value, source);
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
    if (child.type === "text" || child.type === "inlineCode" || child.type === "html") result += child.value;
    else if (child.type === "break") result += "\n";
    else if ("children" in child) result += phrasingText(child.children);
    else if (child.type === "image" || child.type === "imageReference") result += child.alt ?? "";
  }
  return result;
}

function inlineLines(value: CstNode, context: ProjectionContext): PhrasingContent[] {
  const children: PhrasingContent[] = [];
  for (const child of value.children) {
    const projected = "tokenType" in child ? inlineLeaf(child, context) : inlineNode(child, context);
    if (!projected) continue;
    appendInlineValue(context, children, projected, child.offset);
  }
  return children;
}

function emphasis(value: CstNode, context: ProjectionContext, kind: "emphasis" | "strong"): Emphasis | Strong {
  const marker = kind === "strong" ? "Strong" : "Emphasis";
  const [start, end] = contentBounds(value, [`${marker}Open`], [`${marker}Close`]);
  const children = inlineSequence(value.children, context, start, end);
  return kind === "strong"
    ? withSpan(context, { type: "strong", children } satisfies Strong, value.offset, value.end)
    : withSpan(context, { type: "emphasis", children } satisfies Emphasis, value.offset, value.end);
}

function linkOrImage(
  value: CstNode,
  context: ProjectionContext,
  media: "image" | "link",
  resourceKind: "direct" | "reference",
): Image | ImageReference | Link | LinkReference {
  const image = media === "image";
  const referenceNode = resourceKind === "reference";
  const prefix = image ? "Image" : "";
  const resourcePrefix = referenceNode ? "Reference" : "Link";
  const [start, end] = contentBounds(value, [`${prefix}${resourcePrefix}Open`], [`${prefix}${resourcePrefix}Close`]);
  const children = inlineSequence(value.children, context, start, end);
  if (referenceNode) {
    const association = reference(value, context, image);
    return image
      ? withSpan(context, { type: "imageReference", alt: phrasingText(children), ...association } satisfies ImageReference, value.offset, value.end)
      : withSpan(context, { type: "linkReference", children, ...association } satisfies LinkReference, value.offset, value.end);
  }
  const resource = destinationTitle(getText(leaf(value, `${prefix}LinkClose`), context.source).slice(2, -1));
  return image
    ? withSpan(context, { type: "image", alt: phrasingText(children), ...resource } satisfies Image, value.offset, value.end)
    : withSpan(context, { type: "link", children, ...resource } satisfies Link, value.offset, value.end);
}

function inlineNode(value: CstNode, context: ProjectionContext): PhrasingContent[] | PhrasingContent {
  switch (value.rule) {
    case "InlineLines": return inlineLines(value, context);
    case "InlineLine": case "Inline": case "LinkContent": case "BracketFallback":
      return inlineSequence(value.children, context);
    case "Emphasis": case "LinkEmphasis": return emphasis(value, context, "emphasis");
    case "Strong": case "LinkStrong": return emphasis(value, context, "strong");
    case "Image": case "LinkImage": return linkOrImage(value, context, "image", "direct");
    case "ReferenceImage": case "LinkReferenceImage": return linkOrImage(value, context, "image", "reference");
    case "Link": return linkOrImage(value, context, "link", "direct");
    case "ReferenceLink": return linkOrImage(value, context, "link", "reference");
    default: throw new Error(`Unexpected inline CST rule: ${value.rule}`);
  }
}

function inlineChildren(value: CstNode, context: ProjectionContext): PhrasingContent[] {
  const inline = childNodes(value, "InlineLines")[0];
  if (!inline) {
    if (value.rule === "AtxHeading") return [];
    throw new Error(`Expected ${value.rule} CST to contain InlineLines`);
  }
  const result = inlineLines(inline, context);
  const last = result.at(-1);
  if (last?.type === "text") {
    const trimmed = last.value.replace(/[ \t]+$/, "");
    const removed = last.value.length - trimmed.length;
    last.value = trimmed;
    spanOf(context, last).end -= removed;
    if (!last.value) result.pop();
  }
  return result;
}

function fencedCode(value: string): { closed: boolean; node: Code } {
  const source = normalizeLines(value);
  const lines = source.match(/[^\n]*(?:\n|$)/g)?.filter(Boolean);
  if (!lines?.length) throw new Error("FencedCodeBlock token is empty");
  const opening = lines[0];
  const contentLines = lines.slice(1);
  let indent = 0;
  while (indent < 3 && opening[indent] === " ") indent++;
  const marker = opening[indent];
  if (marker !== "`" && marker !== "~") throw new Error("FencedCodeBlock token has no opening fence");
  let markerEnd = indent;
  while (opening[markerEnd] === marker) markerEnd++;
  const markerLength = markerEnd - indent;
  const closing = contentLines.at(-1);
  const closed = Boolean(closing && new RegExp(`^ {0,3}\\${marker}{${markerLength},}[ \\t]*(?:\\n|$)`).test(closing));
  if (closed) contentLines.pop();
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
    if (value[offset] === " ") consumed++;
    else if (value[offset] === "\t") consumed += 4 - (consumed % 4);
    else break;
    offset++;
  }
  return " ".repeat(Math.max(0, consumed - columns)) + value.slice(offset);
}

function indentedCode(value: string): Code {
  const lines = normalizeLines(value).split("\n").map((line) => removeIndent(line, 4));
  while (lines.length) {
    if (!/^[ \t]*$/.test(lines[lines.length - 1])) break;
    lines.pop();
  }
  return { type: "code", lang: null, meta: null, value: lines.join("\n") };
}

function htmlBlockValue(value: string): string {
  const source = normalizeLines(value);
  const lower = source.toLowerCase();
  let terminator: string | null = null;
  const tag = /^ {0,3}<(script|pre|style|textarea)(?:[ \t\n>]|$)/i.exec(source)?.[1];
  if (tag) terminator = `</${tag.toLowerCase()}>`;
  else if (/^ {0,3}<!--/.test(source)) terminator = "-->";
  else if (/^ {0,3}<\?/.test(source)) terminator = "?>";
  else if (/^ {0,3}<!\[cdata\[/i.test(source)) terminator = "]]>";
  else if (/^ {0,3}<![A-Z]/.test(source)) terminator = ">";
  return terminator && !lower.includes(terminator) ? source : source.replace(/\n$/, "");
}

function blockContent(value: CstNode, context: ProjectionContext): BlockContent | DefinitionContent {
  if (value.rule !== "Block") throw new Error(`Expected Block CST, received ${value.rule}`);
  const children = childNodes(value);
  if (children.length !== 1) throw new Error(`Expected Block CST to contain one node, received ${children.length}`);
  return blockNode(children[0], context);
}

function listItem(value: CstNode, context: ProjectionContext): ListItem {
  const { source } = context;
  if (value.rule !== "OrderedListItem" && value.rule !== "UnorderedListItem") {
    throw new Error(`Expected list item CST, received ${value.rule}`);
  }
  const marker = leaf(value, value.rule === "OrderedListItem" ? "OrderedItemOpen" : "UnorderedItemOpen");
  const result = {
    type: "listItem",
    spread: listItemSpread(value, source),
    checked: null,
    children: childNodes(value, "Block").map((child) => blockContent(child, context)),
  } satisfies ListItem;
  return withSpan(context, result, marker.offset, lastChildEnd(context, result, blockEnd(value, source)));
}

function blockNode(value: CstNode, context: ProjectionContext): BlockContent | DefinitionContent {
  const { source } = context;
  switch (value.rule) {
    case "BlockQuote": {
      const result = {
        type: "blockquote",
        children: childNodes(value, "Block").map((child) => blockContent(child, context)),
      } satisfies Blockquote;
      const marker = leaf(value, "BlockQuoteOpen");
      const start = firstNonspace(source, marker.offset, lineEnd(source, value.offset));
      return withSpan(context, result, start, blockEnd(value, source));
    }
    case "UnorderedList": case "OrderedList": {
      const ordered = value.rule === "OrderedList";
      const itemRule = ordered ? "OrderedListItem" : "UnorderedListItem";
      const items = childNodes(value, itemRule);
      const listMarker = leaf(value, ordered ? "OrderedListOpen" : "UnorderedListOpen");
      const result = {
        type: "list",
        ordered,
        start: ordered ? Number.parseInt(getText(listMarker, source), 10) : null,
        spread: listSpread(items, source),
        children: items.map((item) => listItem(item, context)),
      } satisfies List;
      return withSpan(context, result, listMarker.offset, lastChildEnd(context, result, listMarker.end));
    }
    case "AtxHeading": {
      const marker = leaf(value, "AtxHeadingOpen");
      return withSpan(context, {
        type: "heading",
        depth: marker.end - marker.offset as Heading["depth"],
        children: inlineChildren(value, context),
      } satisfies Heading, marker.offset, blockEnd(value, source));
    }
    case "SetextHeading": {
      const levelOne = directLeaf(value, "SetextHeading1Open");
      if (!levelOne) leaf(value, "SetextHeading2Open");
      const result = {
        type: "heading",
        depth: levelOne ? 1 : 2,
        children: inlineChildren(value, context),
      } satisfies Heading;
      return withSpan(context, result, firstChildStart(context, result), leaf(value, "HeadingClose").offset);
    }
    case "Paragraph": {
      const result = { type: "paragraph", children: inlineChildren(value, context) } satisfies Paragraph;
      return withSpan(context, result, firstChildStart(context, result), blockEnd(value, source));
    }
    case "ThematicBreak": return withSpan(
      context,
      { type: "thematicBreak" },
      firstNonspace(source, value.offset, value.end),
      blockEnd(value, source),
    );
    case "FencedCode": {
      const fence = fencedCode(getText(leaf(value, "FencedCodeBlock"), source));
      // An unclosed fence owns the final newline only when it reaches the document's EOF.
      const end = fence.closed || value.end < source.length ? blockEnd(value, source) : value.end;
      return withSpan(context, fence.node, firstNonspace(source, value.offset, lineEnd(source, value.offset)), end);
    }
    case "IndentedCodeBlock": return withSpan(
      context,
      indentedCode(getText(leaf(value, "IndentedCodeBlockToken"), source)),
      value.offset,
      indentedCodeEnd(value, source),
    );
    case "HtmlBlock": {
      const html = htmlBlockValue(getText(leaf(value, "HtmlBlockToken"), source));
      return withSpan(context, { type: "html", value: html } satisfies Html, value.offset, html.endsWith("\n") ? value.end : blockEnd(value, source));
    }
    case "LinkDefinition": return definition(value, context);
    default: throw new Error(`Unexpected block CST rule: ${value.rule}`);
  }
}

/** Convert a block-first Markdown CST into an mdast root without invoking a renderer. */
export function markdownCstToMdast(tree: CstNode, source: string): Root {
  if (tree.rule !== "Document") throw new Error(`Expected Markdown Document CST, received '${tree.rule}'`);
  const context = { source, spans: new WeakMap<object, SourceSpan>() };
  const root = withSpan(context, {
    type: "root",
    children: childNodes(tree, "Block").map((child) => blockContent(child, context)),
  } satisfies Root, 0, source.length);
  return attachPositions(context, root);
}

/** Parse CommonMark source with Monogram and expose its semantic tree as mdast. */
export function markdownToMdast(source: string): Root {
  return markdownCstToMdast(markdownPhasedParser.parse(source), source);
}

export type {
  CstChild,
  CstLeaf,
  CstNode,
  Root,
  RootContent,
  Text,
};
