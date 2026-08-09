import type { Token } from "monogram/gen-lexer.ts";
import { normalizeMarkdownReferenceLabel } from "./inline-utils.ts";
import { createShiftedToken, createTokenChange, type TokenChange, tokenEqualsAfterShift } from "./token-change.ts";
import type { SourceLocation } from "./source-view.ts";
import type { TextEdit } from "./text-edit.ts";

type TokenRange = NonNullable<Token["ranges"]>[number];

interface Line {
  start: number;
  end: number;
  next: number;
  lazy?: boolean;
  prefixColumns?: number;
}

interface Indent {
  offset: number;
  columns: number;
}

interface Fence {
  marker: "`" | "~";
  length: number;
}

interface ListMarker {
  kind: "ordered" | "unordered";
  indent: number;
  offset: number;
  contentOffset: number;
  contentIndent: number;
  contentPrefixColumns: number;
  delimiter: string;
  text: string;
  startNumber?: number;
}

interface HtmlStart {
  interruptParagraph: boolean;
  terminator?: string;
}

interface BlockQuoteMarker {
  offset: number;
  prefixColumns: number;
}

export interface LinkDefinitionFields {
  destination: string;
  label: string;
  markerOffset: number;
  normalizedLabel: string;
  title: string | null;
}

interface LinkDefinitionMatch {
  end: number;
  fields: LinkDefinitionFields;
}

interface LinkDefinitionOpenToken extends Token {
  linkDefinition: LinkDefinitionFields;
}

const htmlBlockTags = new Set([
  "address",
  "article",
  "aside",
  "base",
  "basefont",
  "blockquote",
  "body",
  "caption",
  "center",
  "col",
  "colgroup",
  "dd",
  "details",
  "dialog",
  "dir",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "frame",
  "frameset",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "head",
  "header",
  "hr",
  "html",
  "iframe",
  "legend",
  "li",
  "link",
  "main",
  "menu",
  "menuitem",
  "nav",
  "noframes",
  "ol",
  "optgroup",
  "option",
  "p",
  "param",
  "search",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "title",
  "tr",
  "track",
  "ul",
]);
const htmlTagName = "[a-z][a-z0-9-]*";
const htmlAttributeName = "[a-z_:][\\w.:-]*";
const htmlUnquotedValue = `[^\\s"'=<>\`]+`;
const htmlAttributeValue = `(?:${htmlUnquotedValue}|'[^']*'|"[^"]*")`;
const htmlAttribute = `\\s+${htmlAttributeName}(?:\\s*=\\s*${htmlAttributeValue})?`;
const completeHtmlTag = new RegExp(`^(?:<${htmlTagName}(?:${htmlAttribute})*\\s*/?>|</${htmlTagName}\\s*>)[ \\t]*$`, "i");

function linesOf(source: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  while (start < source.length) {
    let end = start;
    while (end < source.length && source[end] !== "\n" && source[end] !== "\r") {
      end++;
    }
    let next = end;
    if (source[next] === "\r") {
      next += source[next + 1] === "\n" ? 2 : 1;
    }
    else if (source[next] === "\n") {
      next++;
    }
    lines.push({ start, end, next });
    start = next;
  }
  return lines;
}

function indentOf(source: string, line: Line, limit = Number.POSITIVE_INFINITY): Indent {
  let offset = line.start;
  let columns = line.prefixColumns ?? 0;
  while (offset < line.end && columns < limit) {
    if (source[offset] === " ") {
      offset++;
      columns++;
      continue;
    }
    if (source[offset] === "\t") {
      const width = 4 - (columns % 4);
      if (columns + width > limit) {
        break;
      }
      offset++;
      columns += width;
      continue;
    }
    break;
  }
  return { offset, columns };
}

function isBlank(source: string, line: Line): boolean {
  for (let offset = line.start; offset < line.end; offset++) {
    if (source[offset] !== " " && source[offset] !== "\t") {
      return false;
    }
  }
  return true;
}

function named(type: string, text: string, offset: number, ranges?: TokenRange[]): Token {
  return {
    type,
    text,
    offset,
    k: 0,
    t: 0,
    newlineBefore: false,
    commentBefore: false,
    multilineFlowBefore: false,
    ...(ranges?.length ? { ranges } : {}),
  };
}

function structural(type: string, offset: number, text = ""): Token {
  return named(type, text, offset);
}

function linkDefinitionOpen(offset: number, fields: LinkDefinitionFields): LinkDefinitionOpenToken {
  return { ...structural("LinkDefinitionOpen", offset), linkDefinition: fields };
}

export function linkDefinitionFields(token: Token): LinkDefinitionFields {
  const fields = (token as Partial<LinkDefinitionOpenToken>).linkDefinition;
  if (token.type !== "LinkDefinitionOpen" || !fields) {
    throw new Error("Expected LinkDefinitionOpen token to contain parsed fields");
  }
  return fields;
}

function logicalToken(type: string, source: string, lines: readonly Line[], start: number, end: number): Token {
  const ranges = lines.slice(start, end).map((line) => ({ offset: line.start, end: line.next }));
  return named(
    type,
    lines.slice(start, end).map((line) => logicalLine(source, line)).join(""),
    ranges[0].offset,
    ranges,
  );
}

function physicalColumnAt(source: string, offset: number): number {
  let start = offset;
  while (start > 0 && source[start - 1] !== "\n" && source[start - 1] !== "\r") {
    start--;
  }
  let column = 0;
  while (start < offset) {
    column += source[start] === "\t" ? 4 - (column % 4) : 1;
    start++;
  }
  return column;
}

function logicalLine(source: string, line: Line): string {
  let result = " ".repeat(line.prefixColumns ?? 0);
  let offset = line.start;
  let logicalColumn = line.prefixColumns ?? 0;
  let physicalColumn = physicalColumnAt(source, offset);
  while (offset < line.end && logicalColumn < 4 && (source[offset] === " " || source[offset] === "\t")) {
    if (source[offset] === " ") {
      result += " ";
      logicalColumn++;
      physicalColumn++;
    }
    else {
      const logicalWidth = 4 - (logicalColumn % 4);
      const physicalWidth = 4 - (physicalColumn % 4);
      result += "\t" + " ".repeat(Math.max(0, physicalWidth - logicalWidth));
      logicalColumn += Math.max(logicalWidth, physicalWidth);
      physicalColumn += physicalWidth;
    }
    offset++;
  }
  return result + source.slice(offset, line.next);
}

function lineIndent(source: string, line: Line): Indent | null {
  const indent = indentOf(source, line, 3);
  if (source[indent.offset] === " " || source[indent.offset] === "\t") {
    return null;
  }
  return indent;
}

function htmlStartAt(source: string, line: Line): HtmlStart | null {
  const indent = lineIndent(source, line);
  if (!indent || source[indent.offset] !== "<") {
    return null;
  }
  const body = source.slice(indent.offset, line.end);
  const lower = body.toLowerCase();
  for (const tag of ["script", "pre", "style", "textarea"]) {
    if (lower.startsWith(`<${tag}`) && (lower.length === tag.length + 1 || /[ \t>]/.test(lower[tag.length + 1]))) {
      return { interruptParagraph: true, terminator: `</${tag}>` };
    }
  }
  if (body.startsWith("<!--")) {
    return { interruptParagraph: true, terminator: "-->" };
  }
  if (body.startsWith("<?")) {
    return { interruptParagraph: true, terminator: "?>" };
  }
  if (body.startsWith("<![CDATA[")) {
    return { interruptParagraph: true, terminator: "]]>" };
  }
  if (body.startsWith("<!") && /[A-Z]/.test(body[2] ?? "")) {
    return { interruptParagraph: true, terminator: ">" };
  }

  const tag = /^<\/?([a-z][a-z0-9-]*)(?=[ \t\n\r/>]|$)/i.exec(body)?.[1].toLowerCase();
  if (tag && htmlBlockTags.has(tag)) {
    return { interruptParagraph: true };
  }
  if (completeHtmlTag.test(body)) {
    return { interruptParagraph: false };
  }
  return null;
}

function linkDefinitionAt(source: string, lines: readonly Line[], startIndex: number): LinkDefinitionMatch | null {
  const indent = lineIndent(source, lines[startIndex]);
  if (!indent || source[indent.offset] !== "[") {
    return null;
  }
  let lineIndex = startIndex;
  let offset = indent.offset + 1;
  let label = "";
  let labelLength = 0;
  let labelHasContent = false;
  let labelStart = offset;

  for (;;) {
    const line = lines[lineIndex];
    if (!line || offset >= line.end) {
      if (!line || lineIndex + 1 >= lines.length || isBlank(source, lines[lineIndex + 1])) {
        return null;
      }
      if (++labelLength > 999) {
        return null;
      }
      label += source.slice(labelStart, line.next);
      lineIndex++;
      offset = lines[lineIndex].start;
      labelStart = offset;
      continue;
    }
    if (source[offset] === "\\" && offset + 1 < line.end) {
      labelHasContent = true;
      labelLength += 2;
      offset += 2;
      continue;
    }
    if (source[offset] === "[") {
      return null;
    }
    if (source[offset] === "]" && source[offset + 1] === ":") {
      break;
    }
    if (!/[ \t]/.test(source[offset])) {
      labelHasContent = true;
    }
    if (++labelLength > 999) {
      return null;
    }
    offset++;
  }
  label += source.slice(labelStart, offset);
  if (!labelHasContent) {
    return null;
  }
  offset += 2;

  const skipSpaces = (): void => {
    while (offset < lines[lineIndex].end && (source[offset] === " " || source[offset] === "\t")) {
      offset++;
    }
  };
  skipSpaces();
  if (offset === lines[lineIndex].end) {
    if (lineIndex + 1 >= lines.length || isBlank(source, lines[lineIndex + 1])) {
      return null;
    }
    lineIndex++;
    offset = lines[lineIndex].start;
    skipSpaces();
  }

  let destination: string;
  if (source[offset] === "<") {
    offset++;
    const destinationStart = offset;
    while (offset < lines[lineIndex].end && source[offset] !== ">") {
      if (source[offset] === "<") {
        return null;
      }
      if (source[offset] === "\\" && offset + 1 < lines[lineIndex].end) {
        offset += 2;
      }
      else {
        offset++;
      }
    }
    if (source[offset] !== ">") {
      return null;
    }
    destination = source.slice(destinationStart, offset);
    offset++;
  }
  else {
    let depth = 0;
    const destinationStart = offset;
    while (offset < lines[lineIndex].end && source[offset] !== " " && source[offset] !== "\t") {
      if (source[offset] === "\\" && offset + 1 < lines[lineIndex].end) {
        offset += 2;
        continue;
      }
      if (source[offset] === "(") {
        if (++depth > 32) {
          return null;
        }
      }
      else if (source[offset] === ")" && --depth < 0) {
        return null;
      }
      offset++;
    }
    if (offset === destinationStart || depth !== 0) {
      return null;
    }
    destination = source.slice(destinationStart, offset);
  }

  const destinationLine = lineIndex;
  if (offset < lines[lineIndex].end && source[offset] !== " " && source[offset] !== "\t") {
    return null;
  }
  skipSpaces();
  let titleOnNextLine = false;
  if (offset === lines[lineIndex].end && lineIndex + 1 < lines.length && !isBlank(source, lines[lineIndex + 1])) {
    lineIndex++;
    offset = lines[lineIndex].start;
    skipSpaces();
    titleOnNextLine = true;
  }

  const closer = source[offset] === "(" ? ")" : source[offset] === "\"" || source[offset] === "'" ? source[offset] : null;
  const fields: LinkDefinitionFields = {
    destination,
    label,
    markerOffset: indent.offset - lines[startIndex].start,
    normalizedLabel: normalizeMarkdownReferenceLabel(label),
    title: null,
  };
  if (!closer) {
    return { end: destinationLine + 1, fields };
  }
  offset++;
  let title = "";
  let titleStart = offset;
  let closed = false;
  while (lineIndex < lines.length) {
    const line = lines[lineIndex];
    while (offset < line.end) {
      if (source[offset] === "\\" && offset + 1 < line.end) {
        offset += 2;
        continue;
      }
      if (source[offset] === closer) {
        title += source.slice(titleStart, offset);
        offset++;
        closed = true;
        break;
      }
      offset++;
    }
    if (closed) {
      break;
    }
    if (lineIndex + 1 >= lines.length || isBlank(source, lines[lineIndex + 1])) {
      break;
    }
    title += source.slice(titleStart, line.next);
    lineIndex++;
    offset = lines[lineIndex].start;
    titleStart = offset;
  }
  if (!closed) {
    return titleOnNextLine ? { end: destinationLine + 1, fields } : null;
  }
  skipSpaces();
  if (offset !== lines[lineIndex].end) {
    return titleOnNextLine ? { end: destinationLine + 1, fields } : null;
  }
  fields.title = title;
  return { end: lineIndex + 1, fields };
}

function fenceAt(source: string, line: Line): Fence | null {
  const indent = lineIndent(source, line);
  if (!indent) {
    return null;
  }
  const marker = source[indent.offset];
  if (marker !== "`" && marker !== "~") {
    return null;
  }
  const body = source.slice(indent.offset, line.end);
  let length = 0;
  while (body[length] === marker) {
    length++;
  }
  if (length < 3 || (marker === "`" && body.slice(length).includes("`"))) {
    return null;
  }
  return { marker, length };
}

function closesFence(source: string, line: Line, fence: Fence): boolean {
  const indent = lineIndent(source, line);
  if (!indent || source[indent.offset] !== fence.marker) {
    return false;
  }
  const body = source.slice(indent.offset, line.end);
  let length = 0;
  while (body[length] === fence.marker) {
    length++;
  }
  return length >= fence.length && /^[ \t]*$/.test(body.slice(length));
}

function atxAt(source: string, line: Line): { markerOffset: number; marker: string; contentOffset: number; contentEnd: number } | null {
  const indent = lineIndent(source, line);
  if (!indent || source[indent.offset] !== "#") {
    return null;
  }
  const match = /^(#{1,6})(?:[ \t]+|$)/.exec(source.slice(indent.offset, line.end));
  if (!match) {
    return null;
  }
  const contentOffset = indent.offset + match[0].length;
  let contentEnd = line.end;
  while (contentEnd > contentOffset && (source[contentEnd - 1] === " " || source[contentEnd - 1] === "\t")) {
    contentEnd--;
  }
  let closer = contentEnd;
  while (closer > contentOffset && source[closer - 1] === "#") {
    closer--;
  }
  if (closer < contentEnd && (closer === contentOffset || source[closer - 1] === " " || source[closer - 1] === "\t")) {
    contentEnd = closer;
    while (contentEnd > contentOffset && (source[contentEnd - 1] === " " || source[contentEnd - 1] === "\t")) {
      contentEnd--;
    }
  }
  return { markerOffset: indent.offset, marker: match[1], contentOffset, contentEnd };
}

function setextAt(source: string, line: Line): "=" | "-" | null {
  const indent = lineIndent(source, line);
  if (!indent) {
    return null;
  }
  const marker = source[indent.offset];
  const match = marker === "=" || marker === "-"
    ? /^(=+|-+)[ \t]*$/.exec(source.slice(indent.offset, line.end))
    : null;
  return match ? match[1][0] as "=" | "-" : null;
}

function isThematicBreak(source: string, line: Line): boolean {
  const indent = indentOf(source, line, 3);
  const marker = source[indent.offset];
  if (marker !== "*" && marker !== "-" && marker !== "_") {
    return false;
  }
  let count = 0;
  for (let offset = indent.offset; offset < line.end; offset++) {
    const character = source[offset];
    if (character === marker) {
      count++;
    }
    else if (character !== " " && character !== "\t") {
      return false;
    }
  }
  return count >= 3;
}

function blockQuoteOffset(source: string, line: Line): BlockQuoteMarker | null {
  const indent = lineIndent(source, line);
  if (!indent || source[indent.offset] !== ">") {
    return null;
  }
  let offset = indent.offset + 1;
  let prefixColumns = line.prefixColumns ?? 0;
  if (source[offset] === " ") {
    offset++;
  }
  else if (source[offset] === "\t") {
    prefixColumns += 4 - (physicalColumnAt(source, offset) % 4) - 1;
    offset++;
  }
  return { offset, prefixColumns };
}

function listMarkerAt(source: string, line: Line): ListMarker | null {
  const indent = lineIndent(source, line);
  if (!indent) {
    return null;
  }
  const marker = source[indent.offset];
  const markerEnd = indent.offset + 1;
  if ((marker === "-" || marker === "+" || marker === "*")
    && (markerEnd === line.end || source[markerEnd] === " " || source[markerEnd] === "\t")
    && !isThematicBreak(source, line)) {
    const padding = listMarkerPadding(source, line, markerEnd, indent.columns + 1);
    return {
      kind: "unordered",
      indent: indent.columns,
      offset: indent.offset,
      contentOffset: padding.offset,
      contentIndent: indent.columns + 1 + padding.columns,
      contentPrefixColumns: padding.prefixColumns,
      delimiter: marker,
      text: marker,
    };
  }
  const markerCode = source.charCodeAt(indent.offset);
  if (!(markerCode >= 48 && markerCode <= 57)) {
    return null;
  }
  const body = source.slice(indent.offset, line.end);
  const ordered = /^(\d{1,9})([.)])(?=[ \t]|$)/.exec(body);
  if (!ordered) {
    return null;
  }
  const orderedEnd = indent.offset + ordered[0].length;
  const markerWidth = ordered[0].length;
  const padding = listMarkerPadding(source, line, orderedEnd, indent.columns + markerWidth);
  return {
    kind: "ordered",
    indent: indent.columns,
    offset: indent.offset,
    contentOffset: padding.offset,
    contentIndent: indent.columns + markerWidth + padding.columns,
    contentPrefixColumns: padding.prefixColumns,
    delimiter: ordered[2],
    text: ordered[1] + ordered[2],
    startNumber: Number(ordered[1]),
  };
}

function listMarkerPadding(source: string, line: Line, markerEnd: number, markerColumn: number): { offset: number; columns: number; prefixColumns: number } {
  if (markerEnd === line.end) {
    return { offset: markerEnd, columns: 1, prefixColumns: 0 };
  }
  let offset = markerEnd;
  let column = markerColumn;
  while (offset < line.end && (source[offset] === " " || source[offset] === "\t")) {
    column += source[offset] === "\t" ? 4 - (column % 4) : 1;
    offset++;
  }
  const whitespaceColumns = column - markerColumn;
  if (offset < line.end && whitespaceColumns <= 4) {
    return { offset, columns: whitespaceColumns, prefixColumns: 0 };
  }
  const consumedColumn = markerColumn + (source[markerEnd] === "\t" ? 4 - (markerColumn % 4) : 1);
  return { offset: markerEnd + 1, columns: 1, prefixColumns: Math.max(0, consumedColumn - markerColumn - 1) };
}

function sameList(a: ListMarker, b: ListMarker): boolean {
  return a.kind === b.kind && a.delimiter === b.delimiter;
}

function contentAfterColumns(source: string, line: Line, columns: number): { offset: number; prefixColumns: number } {
  let offset = line.start;
  let consumed = line.prefixColumns ?? 0;
  if (consumed >= columns) {
    return { offset, prefixColumns: consumed - columns };
  }
  while (offset < line.end && consumed < columns) {
    if (source[offset] === " ") {
      consumed++;
      offset++;
      continue;
    }
    if (source[offset] === "\t") {
      consumed += 4 - (consumed % 4);
      offset++;
      continue;
    }
    break;
  }
  return { offset, prefixColumns: Math.max(0, consumed - columns) };
}

function paragraphContentStart(source: string, line: Line): number {
  return indentOf(source, line, 3).offset;
}

function interruptsParagraphAt(source: string, line: Line): boolean {
  const listMarker = listMarkerAt(source, line);
  return !!atxAt(source, line)
    || !!fenceAt(source, line)
    || blockQuoteOffset(source, line) !== null
    || isThematicBreak(source, line)
    || !!htmlStartAt(source, line)?.interruptParagraph
    || (hasListContent(source, line, listMarker)
      && (listMarker?.kind === "unordered" || (listMarker?.kind === "ordered" && listMarker.startNumber === 1)));
}

function hasListContent(source: string, line: Line, marker: ListMarker | null): boolean {
  return !!marker && /\S/.test(source.slice(marker.contentOffset, line.end));
}

function startsParagraphAt(source: string, line: Line): boolean {
  return !isBlank(source, line)
    && !interruptsParagraphAt(source, line)
    && indentOf(source, line).columns < 4;
}

function endsWithParagraphLeaf(source: string, line: Line): boolean {
  let contentLine = line;
  for (;;) {
    const quote = blockQuoteOffset(source, contentLine);
    if (quote !== null) {
      contentLine = { ...contentLine, start: quote.offset, prefixColumns: quote.prefixColumns };
      continue;
    }
    const marker = listMarkerAt(source, contentLine);
    if (marker) {
      contentLine = { ...contentLine, start: marker.contentOffset };
      continue;
    }
    return startsParagraphAt(source, contentLine);
  }
}

function emitInlineChunks(source: string, lines: readonly Line[], out: Token[]): void {
  lines.forEach((line, index) => {
    const offset = paragraphContentStart(source, line);
    const end = index < lines.length - 1 ? line.next : line.end;
    if (end > offset) {
      out.push(named("InlineChunk", source.slice(offset, end), offset));
    }
  });
}

function emitParagraph(source: string, lines: readonly Line[], out: Token[]): void {
  if (lines.length === 0) {
    return;
  }
  out.push(structural("ParagraphOpen", lines[0].start));
  emitInlineChunks(source, lines, out);
  out.push(structural("ParagraphClose", lines[lines.length - 1].end));
}

function resolveParagraph(source: string, lines: readonly Line[], start: number, out: Token[]): number {
  const paragraph: Line[] = [];
  let index = start;
  while (index < lines.length) {
    const line = lines[index];
    if (isBlank(source, line)) {
      break;
    }
    if (line.lazy) {
      paragraph.push(line);
      index++;
      continue;
    }
    const setext = setextAt(source, line);
    if (paragraph.length > 0 && setext) {
      out.push(structural(setext === "=" ? "SetextHeading1Open" : "SetextHeading2Open", paragraph[0].start));
      emitInlineChunks(source, paragraph, out);
      out.push(structural("HeadingClose", line.end));
      return index + 1;
    }
    if (paragraph.length > 0 && interruptsParagraphAt(source, line)) {
      break;
    }
    paragraph.push(line);
    index++;
  }
  emitParagraph(source, paragraph, out);
  return index;
}

function resolveBlock(source: string, lines: readonly Line[], start: number, out: Token[]): number {
  const line = lines[start];
  const definition = linkDefinitionAt(source, lines, start);
  if (definition) {
    out.push(linkDefinitionOpen(line.start, definition.fields));
    for (let definitionLine = start; definitionLine < definition.end; definitionLine++) {
      const current = lines[definitionLine];
      const end = definitionLine + 1 < definition.end ? current.next : current.end;
      out.push(named("LinkDefinitionChunk", source.slice(current.start, end), current.start));
    }
    out.push(structural("LinkDefinitionClose", lines[definition.end - 1].end));
    return definition.end;
  }

  const atx = atxAt(source, line);
  if (atx) {
    out.push(structural("AtxHeadingOpen", atx.markerOffset, atx.marker));
    if (atx.contentEnd > atx.contentOffset) {
      out.push(named("InlineChunk", source.slice(atx.contentOffset, atx.contentEnd), atx.contentOffset));
    }
    out.push(structural("HeadingClose", line.end));
    return start + 1;
  }

  const fence = fenceAt(source, line);
  if (fence) {
    let end = start + 1;
    while (end < lines.length && !closesFence(source, lines[end], fence)) {
      end++;
    }
    if (end < lines.length) {
      end++;
    }
    out.push(logicalToken("FencedCodeBlock", source, lines, start, end));
    return end;
  }

  if (isThematicBreak(source, line)) {
    out.push(named("ThematicBreakToken", source.slice(line.start, line.end), line.start));
    return start + 1;
  }

  const htmlStart = htmlStartAt(source, line);
  if (htmlStart) {
    let end = start + 1;
    if (htmlStart.terminator && !source.slice(line.start, line.end).toLowerCase().includes(htmlStart.terminator)) {
      while (end < lines.length
        && !source.slice(lines[end].start, lines[end].end).toLowerCase().includes(htmlStart.terminator)) {
        end++;
      }
      if (end < lines.length) {
        end++;
      }
    }
    else if (!htmlStart.terminator) {
      while (end < lines.length && !isBlank(source, lines[end])) {
        end++;
      }
    }
    out.push(logicalToken("HtmlBlockToken", source, lines, start, end));
    return end;
  }

  const quote = blockQuoteOffset(source, line);
  if (quote !== null) {
    const quoteLines: Line[] = [];
    let index = start;
    let lazyParagraph = false;
    while (index < lines.length) {
      const content = blockQuoteOffset(source, lines[index]);
      if (content !== null) {
        const contentLine = { ...lines[index], start: content.offset, prefixColumns: content.prefixColumns };
        quoteLines.push(contentLine);
        lazyParagraph = endsWithParagraphLeaf(source, contentLine);
        index++;
        continue;
      }
      if (!lazyParagraph || isBlank(source, lines[index])
        || (!lines[index].lazy && interruptsParagraphAt(source, lines[index]))) {
        break;
      }
      quoteLines.push({ ...lines[index], lazy: true });
      index++;
    }
    out.push(structural("BlockQuoteOpen", line.start, ">"));
    resolveLines(source, quoteLines, out);
    out.push(structural("BlockQuoteClose", quoteLines.at(-1)?.next ?? line.start));
    return index;
  }

  const listMarker = listMarkerAt(source, line);
  if (listMarker) {
    const kind = listMarker.kind;
    const listOpen = kind === "ordered" ? "OrderedListOpen" : "UnorderedListOpen";
    const listClose = kind === "ordered" ? "OrderedListClose" : "UnorderedListClose";
    const itemOpen = kind === "ordered" ? "OrderedItemOpen" : "UnorderedItemOpen";
    const itemClose = kind === "ordered" ? "OrderedItemClose" : "UnorderedItemClose";
    out.push(structural(listOpen, listMarker.offset, listMarker.text));
    let index = start;
    let listEnd = listMarker.offset + listMarker.text.length;
    while (index < lines.length) {
      const marker = listMarkerAt(source, lines[index]);
      if (!marker || !sameList(marker, listMarker)) {
        break;
      }
      out.push(structural(itemOpen, marker.offset, marker.text));
      const itemLines: Line[] = [{ ...lines[index], start: marker.contentOffset, prefixColumns: marker.contentPrefixColumns }];
      let hasContent = !isBlank(source, itemLines[0]);
      let lazyParagraph = endsWithParagraphLeaf(source, itemLines[0]);
      index++;
      while (index < lines.length) {
        const candidate = listMarkerAt(source, lines[index]);
        if (candidate && candidate.indent < marker.contentIndent) {
          break;
        }
        if (isBlank(source, lines[index])) {
          if (!hasContent) {
            index++;
            break;
          }
          itemLines.push(lines[index]);
          lazyParagraph = false;
          index++;
          continue;
        }
        const indent = indentOf(source, lines[index]);
        if (indent.columns >= marker.contentIndent) {
          const content = contentAfterColumns(source, lines[index], marker.contentIndent);
          const contentLine = {
            ...lines[index],
            start: content.offset,
            prefixColumns: content.prefixColumns,
          };
          itemLines.push(contentLine);
          hasContent = true;
          lazyParagraph = endsWithParagraphLeaf(source, contentLine);
          index++;
          continue;
        }
        if (!lazyParagraph || interruptsParagraphAt(source, lines[index])) {
          break;
        }
        itemLines.push({ ...lines[index], lazy: true });
        index++;
      }
      resolveLines(source, itemLines, out);
      listEnd = itemLines.at(-1)?.next ?? marker.offset;
      out.push(structural(itemClose, listEnd));
    }
    out.push(structural(listClose, listEnd));
    return index;
  }

  if (indentOf(source, line).columns >= 4) {
    let end = start + 1;
    while (end < lines.length && (isBlank(source, lines[end]) || indentOf(source, lines[end]).columns >= 4)) {
      end++;
    }
    out.push(logicalToken("IndentedCodeBlockToken", source, lines, start, end));
    return end;
  }

  return resolveParagraph(source, lines, start, out);
}

type BlockVisitor = (lineStart: number, lineEnd: number, tokenStart: number, tokenEnd: number) => boolean;

interface BlockCheckpoint {
  lineEnd: number;
  lineStart: number;
  tokenEnd: number;
  tokenStart: number;
}

export interface BlockEditResult {
  change: TokenChange;
  scannedRange: {
    end: number;
    start: number;
  };
}

function resolveLines(source: string, lines: readonly Line[], out: Token[], visit?: BlockVisitor): void {
  for (let index = 0; index < lines.length;) {
    if (isBlank(source, lines[index])) {
      index++;
      continue;
    }
    const lineStart = index;
    const tokenStart = out.length;
    index = resolveBlock(source, lines, index, out);
    if (visit?.(lineStart, index, tokenStart, out.length)) {
      return;
    }
  }
}

function scanBlocks(source: string): { checkpoints: BlockCheckpoint[]; lines: Line[]; tokens: Token[] } {
  const lines = linesOf(source);
  const tokens: Token[] = [];
  const checkpoints: BlockCheckpoint[] = [];
  resolveLines(source, lines, tokens, (lineStart, lineEnd, tokenStart, tokenEnd) => {
    checkpoints.push({
      lineStart: lines[lineStart].start,
      lineEnd: lines[lineEnd - 1].next,
      tokenStart,
      tokenEnd,
    });
    return false;
  });
  return { checkpoints, lines, tokens };
}

function applyBlockEdits(source: string, edits: readonly TextEdit[]): string {
  const parts: string[] = [];
  let cursor = 0;
  for (const [index, edit] of edits.entries()) {
    if (!Number.isInteger(edit.start) || !Number.isInteger(edit.end)
      || edit.start < cursor || edit.start > edit.end || edit.end > source.length) {
      throw new RangeError(`Invalid block edit #${index}: [${edit.start}, ${edit.end})`);
    }
    parts.push(source.slice(cursor, edit.start), edit.text);
    cursor = edit.end;
  }
  parts.push(source.slice(cursor));
  return parts.join("");
}

function definitionRestartBefore(source: string, lines: readonly Line[], changedEnd: number): number | null {
  let low = 0;
  let high = lines.length;
  const offset = Math.max(0, changedEnd - 1);
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (lines[middle].start <= offset) {
      low = middle + 1;
    }
    else {
      high = middle;
    }
  }

  let candidate: number | null = null;
  for (let index = Math.min(low, lines.length) - 1; index >= 0; index--) {
    const line = lines[index];
    if (isBlank(source, line)) {
      break;
    }
    const indent = indentOf(source, line, 3);
    if (source[indent.offset] === "[") {
      candidate = line.start;
    }
  }
  return candidate;
}

function shiftedLine(line: Line, delta: number): Line {
  return { start: line.start + delta, end: line.end + delta, next: line.next + delta };
}

function shiftedLines(source: string, offset: number): Line[] {
  return linesOf(source).map((line) => shiftedLine(line, offset));
}

function updatePhysicalLines(
  previous: readonly Line[],
  nextSource: string,
  restartOffset: number,
  oldDamageEnd: number,
  delta: number,
): Line[] {
  let suffix = previous.findIndex((line) => line.start > oldDamageEnd);
  if (suffix >= 0) {
    suffix = Math.min(previous.length, suffix + 1);
  }
  else {
    suffix = previous.length;
  }
  const oldSuffixOffset = previous[suffix]?.start ?? nextSource.length - delta;
  const newSuffixOffset = oldSuffixOffset + delta;
  const prefix = previous.filter((line) => line.start < restartOffset);
  const changed = shiftedLines(nextSource.slice(restartOffset, newSuffixOffset), restartOffset);
  const unchanged = previous.slice(suffix).map((line) => shiftedLine(line, delta));
  return [...prefix, ...changed, ...unchanged];
}

function sameShiftedBlock(
  previous: readonly Token[],
  checkpoint: BlockCheckpoint,
  next: readonly Token[],
  tokenStart: number,
  tokenEnd: number,
  delta: number,
): boolean {
  const length = checkpoint.tokenEnd - checkpoint.tokenStart;
  if (length !== tokenEnd - tokenStart) {
    return false;
  }
  for (let index = 0; index < length; index++) {
    if (!tokenEqualsAfterShift(previous[checkpoint.tokenStart + index], next[tokenStart + index], delta)) {
      return false;
    }
  }
  return true;
}

// Mdast materialization visits nested spans in source order, so one cursor replaces a binary search per point.
function createForwardLocator(
  lines: readonly Line[],
  sourceLength: number,
  endsInLineEnding: boolean,
): (offset: number) => SourceLocation {
  if (lines.length === 0) {
    return (offset) => {
      if (offset < 0 || offset > sourceLength) {
        throw new RangeError(`Source offset ${offset} is outside the document`);
      }
      return { line: 1, column: 1, offset };
    };
  }
  let line = 0;
  return (offset) => {
    if (offset < 0 || offset > sourceLength) {
      throw new RangeError(`Source offset ${offset} is outside the document`);
    }
    if (offset === sourceLength && endsInLineEnding) {
      return { line: lines.length + 1, column: 1, offset };
    }
    while (line + 1 < lines.length && lines[line + 1].start <= offset) {
      line++;
    }
    return { line: line + 1, column: offset - lines[line].start + 1, offset };
  };
}

function endsInLineEnding(source: string): boolean {
  const ending = source.charCodeAt(source.length - 1);
  return ending === 10 || ending === 13;
}

export class MarkdownBlockScanner {
  #checkpoints: BlockCheckpoint[];
  #lines: Line[];
  #source: string;
  #tokens: Token[];

  constructor(source: string) {
    const initial = scanBlocks(source);
    this.#source = source;
    this.#lines = initial.lines;
    this.#tokens = initial.tokens;
    this.#checkpoints = initial.checkpoints;
  }

  get source(): string {
    return this.#source;
  }

  get tokens(): readonly Token[] {
    return this.#tokens;
  }

  locator(): (offset: number) => SourceLocation {
    const lines = this.#lines;
    const sourceLength = this.#source.length;
    const trailingLineEnding = endsInLineEnding(this.#source);
    return createForwardLocator(lines, sourceLength, trailingLineEnding);
  }

  edit(edits: readonly TextEdit[]): BlockEditResult {
    if (edits.length === 0) {
      return { change: { oldStart: 0, oldEnd: 0, tokens: [] }, scannedRange: { start: 0, end: 0 } };
    }
    const previousSource = this.#source;
    const nextSource = applyBlockEdits(previousSource, edits);
    const firstEdit = edits[0];
    const lastEdit = edits.at(-1)!;
    const delta = nextSource.length - previousSource.length;
    let changedEnd = firstEdit.start;
    let precedingDelta = 0;
    for (const edit of edits) {
      changedEnd = edit.start + precedingDelta + edit.text.length;
      precedingDelta += edit.text.length - (edit.end - edit.start);
    }

    let affected = this.#checkpoints.findIndex((checkpoint) => checkpoint.lineEnd >= firstEdit.start);
    if (affected < 0) {
      affected = Math.max(0, this.#checkpoints.length - 1);
    }
    let restart = this.#checkpoints[affected]?.lineStart > firstEdit.start ? -1 : Math.max(0, affected - 1);
    const initialRestartOffset = this.#checkpoints[restart]?.lineStart ?? 0;
    const nextLines = updatePhysicalLines(this.#lines, nextSource, initialRestartOffset, lastEdit.end, delta);
    const definitionRestart = definitionRestartBefore(nextSource, nextLines, changedEnd);
    if (definitionRestart !== null && definitionRestart < firstEdit.start) {
      const candidate = this.#checkpoints.findIndex((checkpoint) => checkpoint.lineStart <= definitionRestart
        && checkpoint.lineEnd > definitionRestart);
      if (candidate >= 0) {
        restart = restart < 0 ? restart : Math.min(restart, candidate);
      }
    }
    const checkpoint = this.#checkpoints[restart];
    const restartOffset = checkpoint?.lineStart ?? 0;
    const oldTokenStart = checkpoint?.tokenStart ?? 0;
    const restartLine = nextLines.findIndex((line) => line.start >= restartOffset);
    const scanLines = restartLine < 0 ? [] : nextLines.slice(restartLine);
    const replacement: Token[] = [];
    const scanned: BlockCheckpoint[] = [];
    let converged = -1;
    let scannedEnd = nextSource.length;
    resolveLines(nextSource, scanLines, replacement, (lineStart, lineEnd, tokenStart, tokenEnd) => {
      const blockStart = scanLines[lineStart].start;
      const blockEnd = scanLines[lineEnd - 1].next;
      if (blockEnd >= changedEnd) {
        const candidate = this.#checkpoints.findIndex((old) => old.lineStart + delta === blockStart
          && old.lineEnd + delta === blockEnd
          && old.lineStart >= lastEdit.end);
        if (candidate >= 0 && sameShiftedBlock(this.#tokens, this.#checkpoints[candidate], replacement, tokenStart, tokenEnd, delta)) {
          replacement.length = tokenStart;
          converged = candidate;
          scannedEnd = blockEnd;
          return true;
        }
      }
      scanned.push({ lineStart: blockStart, lineEnd: blockEnd, tokenStart, tokenEnd });
      return false;
    });

    const oldTokenEnd = converged < 0 ? this.#tokens.length : this.#checkpoints[converged].tokenStart;
    const tokenDelta = replacement.length - (oldTokenEnd - oldTokenStart);
    const previousTokens = this.#tokens;
    const suffix = delta === 0
      ? previousTokens.slice(oldTokenEnd)
      : previousTokens.slice(oldTokenEnd).map((token) => createShiftedToken(token, delta));
    this.#tokens = [...previousTokens.slice(0, oldTokenStart), ...replacement, ...suffix];
    const prefixCheckpoints = this.#checkpoints.slice(0, Math.max(0, restart));
    const scannedCheckpoints = scanned.map((value) => ({
      ...value,
      tokenStart: oldTokenStart + value.tokenStart,
      tokenEnd: oldTokenStart + value.tokenEnd,
    }));
    const suffixCheckpoints = converged < 0 ? [] : this.#checkpoints.slice(converged).map((value) => ({
      lineStart: value.lineStart + delta,
      lineEnd: value.lineEnd + delta,
      tokenStart: value.tokenStart + tokenDelta,
      tokenEnd: value.tokenEnd + tokenDelta,
    }));
    this.#source = nextSource;
    this.#lines = nextLines;
    this.#checkpoints = [...prefixCheckpoints, ...scannedCheckpoints, ...suffixCheckpoints];
    return {
      change: createTokenChange(previousTokens, this.#tokens, delta),
      scannedRange: { start: restartOffset, end: scannedEnd },
    };
  }
}

export function createBlockScanner(source: string): MarkdownBlockScanner {
  return new MarkdownBlockScanner(source);
}
