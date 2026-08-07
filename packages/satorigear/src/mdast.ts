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
import type { Token } from "monogram/gen-lexer.ts";
import { normalizeMarkdownReferenceLabel } from "./grammar-inline.ts";
import type { SyntaxTree, SyntaxTreeLeaf, SyntaxTreeNode } from "./emitted-parser.ts";
import type { SourceLocation, SourceSpan, SourceView } from "./source-view.ts";

interface Resource {
  url: string;
  title: string | null;
}

interface Reference {
  identifier: string;
  label: string;
  referenceType: "collapsed" | "full" | "shortcut";
}

interface BlockProjectionContext {
  block: SyntaxTree;
  source: string;
  syntax: MarkdownSyntax;
}

interface InlineProjectionContext {
  source: string;
  syntax: MarkdownSyntax;
  view: SourceView;
}

export type MarkdownSyntaxNode = SyntaxTreeNode;
export type MarkdownSyntaxLeaf = SyntaxTreeLeaf;
export type MarkdownSyntaxChild = MarkdownSyntaxLeaf | MarkdownSyntaxNode;

export interface MarkdownInlineSyntax {
  root: MarkdownSyntaxNode;
  view: SourceView;
}

export interface MarkdownSyntax {
  blockTree: () => SyntaxTree;
  children: (node: MarkdownSyntaxNode) => readonly MarkdownSyntaxChild[];
  inlineForBlock: (nodeId: number) => MarkdownInlineSyntax | undefined;
  isLeaf: (child: MarkdownSyntaxChild) => child is MarkdownSyntaxLeaf;
  rule: (node: MarkdownSyntaxNode) => string;
  // Spans remain in the coordinate space of their owning syntax tree.
  span: (value: MarkdownSyntaxChild) => SourceSpan;
  text: (leaf: MarkdownSyntaxLeaf) => string;
  tokenType: (leaf: MarkdownSyntaxLeaf) => string;
}

export interface BlockFragment {
  node: BlockContent | DefinitionContent;
  origin: number;
}

export interface PlacedBlockFragment {
  fragment: BlockFragment;
  offset: number;
}

interface FragmentValue {
  [key: string]: unknown;
  children?: FragmentValue[];
  endOffset: number;
  startOffset: number;
}

interface MaterializedValue {
  children?: MaterializedValue[];
  position: { end: SourceLocation; start: SourceLocation };
}

function withSpan<const T extends object>(value: T, start: number, end: number): T {
  const fragment = value as T & FragmentValue;
  fragment.startOffset = start;
  fragment.endOffset = end;
  return value;
}

function extendSpan(value: object, end: number): void {
  const fragment = value as FragmentValue;
  fragment.endOffset = Math.max(fragment.endOffset, end);
}

function blockEnd(nodeId: number, offset: number, context: BlockProjectionContext): number {
  let end = offset + context.block.arena.lenOf(nodeId);
  if (end > offset && context.source[end - 1] === "\n") {
    end--;
  }
  if (end > offset && context.source[end - 1] === "\r") {
    end--;
  }
  return end;
}

function tokenStart(token: Token): number {
  return token.ranges?.[0]?.offset ?? token.offset;
}

function tokenEnd(token: Token): number {
  return token.ranges?.at(-1)?.end ?? token.offset + token.text.length;
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

function firstChildStart(value: { children: readonly object[] }): number {
  const first = value.children[0];
  if (!first) {
    throw new Error("mdast container unexpectedly has no children");
  }
  return (first as FragmentValue).startOffset;
}

function lastChildEnd(value: { children: readonly object[] }, emptyEnd: number): number {
  const last = value.children.at(-1);
  return last ? (last as FragmentValue).endOffset : emptyEnd;
}

function firstNonspace(source: string, start: number, end: number): number {
  while (start < end && (source[start] === " " || source[start] === "\t")) {
    start++;
  }
  return start;
}

function indentedCodeEnd(nodeId: number, tokenBase: number, context: BlockProjectionContext): number {
  const token = blockToken(nodeId, tokenBase, "IndentedCodeBlockToken", context);
  const spans = token.ranges ?? [{ offset: token.offset, end: token.offset + token.text.length }];
  // Blank indented lines belong to the block; the bare separator newline after them does not.
  for (let index = spans.length - 1; index >= 0; index--) {
    const span = spans[index];
    if (/[^\r\n]/.test(context.source.slice(span.offset, span.end))) {
      let end = span.end;
      while (end > span.offset && /[\r\n]/.test(context.source[end - 1])) {
        end--;
      }
      return end;
    }
  }
  throw new Error("IndentedCodeBlockToken has no source content");
}

const semanticCharacter = /\\([!"#$%&'()*+,./:;<=>?@[\\\]^_`{|}~-])|&(?:#x[\da-f]{1,6}|#\d{1,7}|[a-z][\da-z]{1,31});/gi;

function semanticText(value: string): string {
  return value.replace(semanticCharacter, (match, escaped) => escaped ?? decodeHTMLStrict(match));
}

function identifier(value: string): string {
  return normalizeMarkdownReferenceLabel(value).toLowerCase();
}

function directLeaf(
  value: MarkdownSyntaxNode,
  tokenType: string,
  context: InlineProjectionContext,
): MarkdownSyntaxLeaf | undefined {
  return context.syntax.children(value).find((child): child is MarkdownSyntaxLeaf => (
    context.syntax.isLeaf(child) && context.syntax.tokenType(child) === tokenType
  ));
}

function leaf(value: MarkdownSyntaxNode, tokenType: string, context: InlineProjectionContext): MarkdownSyntaxLeaf {
  const result = directLeaf(value, tokenType, context);
  if (!result) {
    throw new Error(`Expected ${context.syntax.rule(value)} syntax to contain ${tokenType}`);
  }
  return result;
}

function leafOfTypes(
  value: MarkdownSyntaxNode,
  tokenTypes: readonly string[],
  context: InlineProjectionContext,
): MarkdownSyntaxLeaf {
  const result = context.syntax.children(value).find((child): child is MarkdownSyntaxLeaf => (
    context.syntax.isLeaf(child) && tokenTypes.includes(context.syntax.tokenType(child))
  ));
  if (!result) {
    throw new Error(`Expected ${context.syntax.rule(value)} syntax to contain one of: ${tokenTypes.join(", ")}`);
  }
  return result;
}

function directBlockToken(
  nodeId: number,
  tokenBase: number,
  tokenType: string,
  context: BlockProjectionContext,
): Token | undefined {
  const arena = context.block.arena;
  const childCount = arena.childCount(nodeId);
  for (let index = 0; index < childCount; index++) {
    const entry = arena.childAt(nodeId, index);
    if (entry < 0) {
      const token = context.block.tokenAt(arena.leafToken(entry, tokenBase));
      if (token.type === tokenType) {
        return token;
      }
    }
  }
}

function blockToken(
  nodeId: number,
  tokenBase: number,
  tokenType: string,
  context: BlockProjectionContext,
): Token {
  const token = directBlockToken(nodeId, tokenBase, tokenType, context);
  if (!token) {
    throw new Error(`Expected ${context.block.arena.ruleNameOf(nodeId)} syntax to contain ${tokenType}`);
  }
  return token;
}

function payloadBounds(
  nodeId: number,
  offset: number,
  tokenBase: number,
  context: BlockProjectionContext,
): SourceSpan {
  const arena = context.block.arena;
  const result = { start: offset + arena.lenOf(nodeId), end: offset };
  const visit = (currentId: number, currentTokenBase: number): void => {
    const childCount = arena.childCount(currentId);
    for (let index = 0; index < childCount; index++) {
      const child = arena.childAt(currentId, index);
      if (child < 0) {
        const token = context.block.tokenAt(arena.leafToken(child, currentTokenBase));
        const start = tokenStart(token);
        const end = tokenEnd(token);
        if (end > start) {
          result.start = Math.min(result.start, start);
          result.end = Math.max(result.end, end);
        }
      }
      else {
        visit(child, currentTokenBase + arena.childTokRelAt(currentId, index));
      }
    }
  };
  visit(nodeId, tokenBase);
  return result;
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

function childrenSpread(
  nodeId: number,
  offset: number,
  tokenBase: number,
  childRule: string,
  stripBlockQuotes: boolean,
  context: BlockProjectionContext,
): boolean {
  const arena = context.block.arena;
  let previous: SourceSpan | undefined;
  const childCount = arena.childCount(nodeId);
  for (let index = 0; index < childCount; index++) {
    const childId = arena.childAt(nodeId, index);
    if (childId < 0 || arena.ruleNameOf(childId) !== childRule) {
      continue;
    }
    const childOffset = offset + arena.childRelAt(nodeId, index);
    const childTokenBase = tokenBase + arena.childTokRelAt(nodeId, index);
    const current = payloadBounds(childId, childOffset, childTokenBase, context);
    if (previous && hasBlankLineBetween(context.source, previous.end, current.start, stripBlockQuotes)) {
      return true;
    }
    previous = current;
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

function definition(nodeId: number, offset: number, context: BlockProjectionContext): Definition {
  const text = context.source.slice(offset, offset + context.block.arena.lenOf(nodeId));
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
  return withSpan({
    type: "definition",
    identifier: identifier(labelSource),
    label: semanticText(labelSource),
    ...destinationTitle(text.slice(close + 2)),
  }, offset + open, blockEnd(nodeId, offset, context));
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

function appendText(target: PhrasingContent[], value: string, start: number, end: number): void {
  if (!value) {
    return;
  }
  const previous = target.at(-1);
  if (previous?.type === "text") {
    previous.value += value;
    extendSpan(previous, end);
  }
  else {
    target.push(withSpan({ type: "text", value }, start, end));
  }
}

function appendPhrasing(target: PhrasingContent[], value: PhrasingContent): void {
  if (value.type === "text") {
    const fragment = value as PhrasingContent & FragmentValue;
    appendText(target, value.value, fragment.startOffset, fragment.endOffset);
  }
  else {
    target.push(value);
  }
}

function firstPhrasing(value: PhrasingContent[] | PhrasingContent): PhrasingContent | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function inlineLeaf(
  value: MarkdownSyntaxLeaf,
  sourceSpan: SourceSpan,
  context: InlineProjectionContext,
): PhrasingContent | undefined {
  const text = context.syntax.text(value);
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
      return withSpan({ type: "text", value: semanticText(text) }, sourceSpan.start, sourceSpan.end);
    case "CodeSpan": return withSpan({ type: "inlineCode", value: codeSpanValue(text) } satisfies InlineCode, sourceSpan.start, sourceSpan.end);
    case "InlineHtml":
    case "HtmlComment": return withSpan({ type: "html", value: text } satisfies Html, sourceSpan.start, sourceSpan.end);
    case "HardBreak": return withSpan({ type: "break" }, sourceSpan.start, sourceSpan.end);
    case "Newline": return withSpan({ type: "text", value: "\n" }, sourceSpan.start, sourceSpan.end);
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
      return withSpan({
        type: "link",
        url: label.includes(":") ? label : `mailto:${label}`,
        title: null,
        children: [withSpan({ type: "text", value: label }, sourceSpan.start + 1, sourceSpan.end - 1)],
      } satisfies Link, sourceSpan.start, sourceSpan.end);
    }
    default: throw new Error(`Unexpected inline token: ${context.syntax.tokenType(value)}`);
  }
}

function contentBounds(
  value: MarkdownSyntaxNode,
  openTypes: readonly string[],
  closeTypes: readonly string[],
  context: InlineProjectionContext,
): [number, number] {
  return [
    context.syntax.span(leafOfTypes(value, openTypes, context)).end,
    context.syntax.span(leafOfTypes(value, closeTypes, context)).start,
  ];
}

function trailingWhitespaceStart(value: string): number {
  let offset = value.length;
  while (offset > 0 && (value[offset - 1] === " " || value[offset - 1] === "\t")) {
    offset--;
  }
  return offset;
}

function appendInlineValue(
  context: InlineProjectionContext,
  target: PhrasingContent[],
  value: PhrasingContent[] | PhrasingContent,
  nextLineOffset: number,
): void {
  const first = firstPhrasing(value);
  if (first?.type === "text" && first.value.startsWith("\n")) {
    // Markdown syntax newlines point past stripped container prefixes, while mdast spans include the physical line ending.
    const previous = target.at(-1);
    if (!Array.isArray(value) && previous?.type === "break") {
      extendSpan(previous, lineStart(context.source, nextLineOffset));
      return;
    }
    (first as PhrasingContent & FragmentValue).startOffset = lineEndingStart(context.source, nextLineOffset);
    if (previous?.type === "text") {
      previous.value = previous.value.slice(0, trailingWhitespaceStart(previous.value));
    }
  }
  if (Array.isArray(value)) {
    value.forEach((child) => appendPhrasing(target, child));
  }
  else {
    appendPhrasing(target, value);
  }
}

function inlineSequence(
  value: MarkdownSyntaxNode,
  context: InlineProjectionContext,
  start?: number,
  end?: number,
): PhrasingContent[] {
  const result: PhrasingContent[] = [];
  let cursor = start;
  for (const child of context.syntax.children(value)) {
    const syntaxSpan = context.syntax.span(child);
    const sourceSpan = context.view.mapSpan(syntaxSpan.start, syntaxSpan.end);
    const projected = context.syntax.isLeaf(child)
      ? inlineLeaf(child, sourceSpan, context)
      : inlineNode(child, syntaxSpan, sourceSpan, context);
    if (!projected) {
      continue;
    }
    const first = firstPhrasing(projected);
    // Newline projection owns the whitespace between logical lines.
    if (cursor !== void 0 && syntaxSpan.start > cursor
      && !(first?.type === "text" && first.value.startsWith("\n"))) {
      const gapSpan = context.view.mapSpan(cursor, syntaxSpan.start);
      appendText(
        result,
        semanticText(context.view.text.slice(cursor, syntaxSpan.start).replace(/[\r\n]/g, "")),
        gapSpan.start,
        gapSpan.end,
      );
    }
    appendInlineValue(context, result, projected, sourceSpan.start);
    cursor = syntaxSpan.end;
  }
  if (cursor !== void 0 && end !== void 0 && end > cursor) {
    const gapSpan = context.view.mapSpan(cursor, end);
    appendText(
      result,
      semanticText(context.view.text.slice(cursor, end).replace(/[\r\n]/g, "")),
      gapSpan.start,
      gapSpan.end,
    );
  }
  return result;
}

function reference(
  value: MarkdownSyntaxNode,
  syntaxSpan: SourceSpan,
  context: InlineProjectionContext,
  image: boolean,
): Reference {
  const close = leaf(value, image ? "ImageReferenceClose" : "ReferenceClose", context);
  const closeText = context.syntax.text(close);
  const text = context.view.text.slice(syntaxSpan.start, syntaxSpan.end);
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

function inlineLines(value: MarkdownSyntaxNode, context: InlineProjectionContext): PhrasingContent[] {
  return inlineSequence(value, context);
}

function emphasis(
  value: MarkdownSyntaxNode,
  sourceSpan: SourceSpan,
  context: InlineProjectionContext,
  kind: "emphasis" | "strong",
): Emphasis | Strong {
  const marker = kind === "strong" ? "Strong" : "Emphasis";
  const [start, end] = contentBounds(value, [`${marker}Open`], [`${marker}Close`], context);
  const children = inlineSequence(value, context, start, end);
  return kind === "strong"
    ? withSpan({ type: "strong", children } satisfies Strong, sourceSpan.start, sourceSpan.end)
    : withSpan({ type: "emphasis", children } satisfies Emphasis, sourceSpan.start, sourceSpan.end);
}

function linkOrImage(
  value: MarkdownSyntaxNode,
  syntaxSpan: SourceSpan,
  sourceSpan: SourceSpan,
  context: InlineProjectionContext,
  media: "image" | "link",
  resourceKind: "direct" | "reference",
): Image | ImageReference | Link | LinkReference {
  const image = media === "image";
  const referenceNode = resourceKind === "reference";
  const prefix = image ? "Image" : "";
  const resourcePrefix = referenceNode ? "Reference" : "Link";
  const [start, end] = contentBounds(value, [`${prefix}${resourcePrefix}Open`], [`${prefix}${resourcePrefix}Close`], context);
  const children = inlineSequence(value, context, start, end);
  if (referenceNode) {
    const association = reference(value, syntaxSpan, context, image);
    return image
      ? withSpan({ type: "imageReference", alt: phrasingText(children), ...association } satisfies ImageReference, sourceSpan.start, sourceSpan.end)
      : withSpan({ type: "linkReference", children, ...association } satisfies LinkReference, sourceSpan.start, sourceSpan.end);
  }
  const resource = destinationTitle(context.syntax.text(leaf(value, `${prefix}LinkClose`, context)).slice(2, -1));
  return image
    ? withSpan({ type: "image", alt: phrasingText(children), ...resource } satisfies Image, sourceSpan.start, sourceSpan.end)
    : withSpan({ type: "link", children, ...resource } satisfies Link, sourceSpan.start, sourceSpan.end);
}

function inlineNode(
  value: MarkdownSyntaxNode,
  syntaxSpan: SourceSpan,
  sourceSpan: SourceSpan,
  context: InlineProjectionContext,
): PhrasingContent[] | PhrasingContent {
  switch (context.syntax.rule(value)) {
    case "InlineLines": return inlineLines(value, context);
    case "InlineLine":
    case "Inline":
    case "LinkContent":
    case "BracketFallback":
      return inlineSequence(value, context);
    case "Emphasis":
    case "LinkEmphasis": return emphasis(value, sourceSpan, context, "emphasis");
    case "Strong":
    case "LinkStrong": return emphasis(value, sourceSpan, context, "strong");
    case "Image":
    case "LinkImage": return linkOrImage(value, syntaxSpan, sourceSpan, context, "image", "direct");
    case "ReferenceImage":
    case "LinkReferenceImage": return linkOrImage(value, syntaxSpan, sourceSpan, context, "image", "reference");
    case "Link": return linkOrImage(value, syntaxSpan, sourceSpan, context, "link", "direct");
    case "ReferenceLink": return linkOrImage(value, syntaxSpan, sourceSpan, context, "link", "reference");
    default: throw new Error(`Unexpected inline syntax rule: ${context.syntax.rule(value)}`);
  }
}

function inlineChildren(nodeId: number, context: BlockProjectionContext): PhrasingContent[] {
  const inline = context.syntax.inlineForBlock(nodeId);
  if (!inline) {
    const rule = context.block.arena.ruleNameOf(nodeId);
    if (rule === "AtxHeading") {
      return [];
    }
    throw new Error(`Expected ${rule} syntax to contain InlineLines`);
  }
  const result = inlineLines(inline.root, {
    source: context.source,
    syntax: context.syntax,
    view: inline.view,
  });
  const last = result.at(-1);
  if (last?.type === "text") {
    const end = trailingWhitespaceStart(last.value);
    const removed = last.value.length - end;
    last.value = last.value.slice(0, end);
    (last as PhrasingContent & FragmentValue).endOffset -= removed;
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

function blockChildren(
  nodeId: number,
  offset: number,
  tokenBase: number,
  context: BlockProjectionContext,
): (BlockContent | DefinitionContent)[] {
  const arena = context.block.arena;
  const children: (BlockContent | DefinitionContent)[] = [];
  const childCount = arena.childCount(nodeId);
  for (let index = 0; index < childCount; index++) {
    const childId = arena.childAt(nodeId, index);
    if (childId >= 0 && arena.ruleNameOf(childId) === "Block") {
      children.push(blockContent(
        childId,
        offset + arena.childRelAt(nodeId, index),
        tokenBase + arena.childTokRelAt(nodeId, index),
        context,
      ));
    }
  }
  return children;
}

function blockContent(
  nodeId: number,
  offset: number,
  tokenBase: number,
  context: BlockProjectionContext,
): BlockContent | DefinitionContent {
  const arena = context.block.arena;
  const rule = arena.ruleNameOf(nodeId);
  if (rule !== "Block") {
    throw new Error(`Expected Block syntax, received ${rule}`);
  }
  let contentId = -1;
  let contentOffset = 0;
  let contentTokenBase = 0;
  let nodeCount = 0;
  const childCount = arena.childCount(nodeId);
  for (let index = 0; index < childCount; index++) {
    const childId = arena.childAt(nodeId, index);
    if (childId >= 0) {
      contentId = childId;
      contentOffset = offset + arena.childRelAt(nodeId, index);
      contentTokenBase = tokenBase + arena.childTokRelAt(nodeId, index);
      nodeCount++;
    }
  }
  if (nodeCount !== 1) {
    throw new Error(`Expected Block syntax to contain one node, received ${nodeCount}`);
  }
  return blockNode(contentId, contentOffset, contentTokenBase, context);
}

function listItem(
  nodeId: number,
  offset: number,
  tokenBase: number,
  context: BlockProjectionContext,
): ListItem {
  const rule = context.block.arena.ruleNameOf(nodeId);
  if (rule !== "OrderedListItem" && rule !== "UnorderedListItem") {
    throw new Error(`Expected list item syntax, received ${rule}`);
  }
  const marker = blockToken(
    nodeId,
    tokenBase,
    rule === "OrderedListItem" ? "OrderedItemOpen" : "UnorderedItemOpen",
    context,
  );
  const result = {
    type: "listItem",
    spread: childrenSpread(nodeId, offset, tokenBase, "Block", true, context),
    checked: null,
    children: blockChildren(nodeId, offset, tokenBase, context),
  } satisfies ListItem;
  return withSpan(result, tokenStart(marker), lastChildEnd(result, blockEnd(nodeId, offset, context)));
}

function blockNode(
  nodeId: number,
  offset: number,
  tokenBase: number,
  context: BlockProjectionContext,
): BlockContent | DefinitionContent {
  const { source } = context;
  const arena = context.block.arena;
  const end = offset + arena.lenOf(nodeId);
  const rule = arena.ruleNameOf(nodeId);
  switch (rule) {
    case "BlockQuote": {
      const result = {
        type: "blockquote",
        children: blockChildren(nodeId, offset, tokenBase, context),
      } satisfies Blockquote;
      const marker = blockToken(nodeId, tokenBase, "BlockQuoteOpen", context);
      const start = firstNonspace(source, tokenStart(marker), lineEnd(source, offset));
      return withSpan(result, start, blockEnd(nodeId, offset, context));
    }
    case "UnorderedList":
    case "OrderedList": {
      const ordered = rule === "OrderedList";
      const itemRule = ordered ? "OrderedListItem" : "UnorderedListItem";
      const listMarker = blockToken(nodeId, tokenBase, ordered ? "OrderedListOpen" : "UnorderedListOpen", context);
      const items: ListItem[] = [];
      const childCount = arena.childCount(nodeId);
      for (let index = 0; index < childCount; index++) {
        const childId = arena.childAt(nodeId, index);
        if (childId >= 0 && arena.ruleNameOf(childId) === itemRule) {
          items.push(listItem(
            childId,
            offset + arena.childRelAt(nodeId, index),
            tokenBase + arena.childTokRelAt(nodeId, index),
            context,
          ));
        }
      }
      const result = {
        type: "list",
        ordered,
        start: ordered ? Number.parseInt(listMarker.text, 10) : null,
        spread: childrenSpread(nodeId, offset, tokenBase, itemRule, false, context),
        children: items,
      } satisfies List;
      return withSpan(result, tokenStart(listMarker), lastChildEnd(result, tokenEnd(listMarker)));
    }
    case "AtxHeading": {
      const marker = blockToken(nodeId, tokenBase, "AtxHeadingOpen", context);
      return withSpan({
        type: "heading",
        depth: tokenEnd(marker) - tokenStart(marker) as Heading["depth"],
        children: inlineChildren(nodeId, context),
      } satisfies Heading, tokenStart(marker), blockEnd(nodeId, offset, context));
    }
    case "SetextHeading": {
      const levelOne = directBlockToken(nodeId, tokenBase, "SetextHeading1Open", context);
      if (!levelOne) {
        blockToken(nodeId, tokenBase, "SetextHeading2Open", context);
      }
      const result = {
        type: "heading",
        depth: levelOne ? 1 : 2,
        children: inlineChildren(nodeId, context),
      } satisfies Heading;
      return withSpan(
        result,
        firstChildStart(result),
        tokenStart(blockToken(nodeId, tokenBase, "HeadingClose", context)),
      );
    }
    case "Paragraph": {
      const result = { type: "paragraph", children: inlineChildren(nodeId, context) } satisfies Paragraph;
      return withSpan(result, firstChildStart(result), blockEnd(nodeId, offset, context));
    }
    case "ThematicBreak": return withSpan(
      { type: "thematicBreak" },
      firstNonspace(source, offset, end),
      blockEnd(nodeId, offset, context),
    );
    case "FencedCode": {
      const fence = fencedCode(blockToken(nodeId, tokenBase, "FencedCodeBlock", context).text);
      // An unclosed fence owns the final newline only when it reaches the document's EOF.
      const codeEnd = fence.closed || end < source.length ? blockEnd(nodeId, offset, context) : end;
      return withSpan(fence.node, firstNonspace(source, offset, lineEnd(source, offset)), codeEnd);
    }
    case "IndentedCodeBlock": return withSpan(
      indentedCode(blockToken(nodeId, tokenBase, "IndentedCodeBlockToken", context).text),
      offset,
      indentedCodeEnd(nodeId, tokenBase, context),
    );
    case "HtmlBlock": {
      const html = htmlBlockValue(blockToken(nodeId, tokenBase, "HtmlBlockToken", context).text);
      return withSpan({ type: "html", value: html } satisfies Html, offset, html.endsWith("\n") ? end : blockEnd(nodeId, offset, context));
    }
    case "LinkDefinition": return definition(nodeId, offset, context);
    default: throw new Error(`Unexpected block syntax rule: ${rule}`);
  }
}

export function projectBlock(
  nodeId: number,
  offset: number,
  tokenBase: number,
  source: string,
  syntax: MarkdownSyntax,
): BlockFragment {
  const context = { block: syntax.blockTree(), source, syntax };
  const node = blockContent(nodeId, offset, tokenBase, context);
  return { node, origin: offset };
}

function materializeBlock(
  fragment: BlockFragment,
  offset: number,
  point: (offset: number) => SourceLocation,
): BlockContent | DefinitionContent {
  const shift = offset - fragment.origin;
  const clone = (value: FragmentValue): MaterializedValue => {
    const result = {} as MaterializedValue & Record<string, unknown>;
    for (const key in value) {
      if (key !== "startOffset" && key !== "endOffset" && key !== "children") {
        result[key] = value[key];
      }
    }
    if (value.children) {
      result.children = value.children.map(clone);
    }
    result.position = {
      start: point(shift + value.startOffset),
      end: point(shift + value.endOffset),
    };
    return result;
  };
  return clone(fragment.node as unknown as FragmentValue) as unknown as BlockContent | DefinitionContent;
}

export function materialize(
  fragments: readonly PlacedBlockFragment[],
  sourceLength: number,
  locate: (offset: number) => SourceLocation,
): Root {
  return {
    type: "root",
    children: fragments.map(({ fragment, offset }) => materializeBlock(fragment, offset, locate)),
    position: { start: locate(0), end: locate(sourceLength) },
  } satisfies Root;
}
