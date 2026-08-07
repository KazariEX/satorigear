import { alt, defineGrammar, many, many1, never, rule, type RuleRef, token } from "../../../vendors/monogram/src/api.ts";
import type { Token } from "../../../vendors/monogram/src/gen-lexer.ts";

const ParagraphOpen = token(never());
const ParagraphClose = token(never());
const AtxHeadingOpen = token(never());
const SetextHeading1Open = token(never());
const SetextHeading2Open = token(never());
const HeadingClose = token(never());
const BlockQuoteOpen = token(never());
const BlockQuoteClose = token(never());
const UnorderedListOpen = token(never());
const UnorderedListClose = token(never());
const UnorderedItemOpen = token(never());
const UnorderedItemClose = token(never());
const OrderedListOpen = token(never());
const OrderedListClose = token(never());
const OrderedItemOpen = token(never());
const OrderedItemClose = token(never());
const InlineChunk = token(never());
const FencedCodeBlock = token(never());
const IndentedCodeBlockToken = token(never());
const ThematicBreakToken = token(never());
const HtmlBlockToken = token(never());

const Paragraph = rule(() => [[ParagraphOpen, many1(InlineChunk), ParagraphClose]]);
const AtxHeading = rule(() => [[AtxHeadingOpen, many(InlineChunk), HeadingClose]]);
const SetextHeading = rule(() => [[alt(SetextHeading1Open, SetextHeading2Open), many1(InlineChunk), HeadingClose]]);
const FencedCode = rule(() => [FencedCodeBlock]);
const IndentedCodeBlock = rule(() => [IndentedCodeBlockToken]);
const ThematicBreak = rule(() => [ThematicBreakToken]);
const HtmlBlock = rule(() => [HtmlBlockToken]);
let Block: RuleRef;
const BlockQuote = rule(() => [[BlockQuoteOpen, many(Block), BlockQuoteClose]]);
const UnorderedListItem = rule(() => [[UnorderedItemOpen, many(Block), UnorderedItemClose]]);
const OrderedListItem = rule(() => [[OrderedItemOpen, many(Block), OrderedItemClose]]);
const UnorderedList = rule(() => [[UnorderedListOpen, many1(UnorderedListItem), UnorderedListClose]]);
const OrderedList = rule(() => [[OrderedListOpen, many1(OrderedListItem), OrderedListClose]]);
Block = rule(() => [
  AtxHeading,
  SetextHeading,
  ThematicBreak,
  FencedCode,
  IndentedCodeBlock,
  HtmlBlock,
  BlockQuote,
  UnorderedList,
  OrderedList,
  Paragraph,
]);
const Document = rule(() => [[many(Block)]]);

export const markdownBlockGrammar = defineGrammar({
  name: "markdown-blocks",
  tokens: {
    ParagraphOpen,
    ParagraphClose,
    AtxHeadingOpen,
    SetextHeading1Open,
    SetextHeading2Open,
    HeadingClose,
    BlockQuoteOpen,
    BlockQuoteClose,
    UnorderedListOpen,
    UnorderedListClose,
    UnorderedItemOpen,
    UnorderedItemClose,
    OrderedListOpen,
    OrderedListClose,
    OrderedItemOpen,
    OrderedItemClose,
    InlineChunk,
    FencedCodeBlock,
    IndentedCodeBlockToken,
    ThematicBreakToken,
    HtmlBlockToken,
  },
  rules: {
    Paragraph,
    AtxHeading,
    SetextHeading,
    FencedCode,
    IndentedCodeBlock,
    HtmlBlock,
    ThematicBreak,
    BlockQuote,
    UnorderedListItem,
    OrderedListItem,
    UnorderedList,
    OrderedList,
    Block,
    Document,
  },
  entry: Document,
});

interface Line {
  start: number;
  end: number;
  next: number;
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
  offset: number;
  contentOffset: number;
  text: string;
  startNumber?: number;
}

interface HtmlStart {
  interruptParagraph: boolean;
  terminator?: string;
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

function linesOf(source: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  while (start < source.length) {
    let end = start;
    while (end < source.length && source[end] !== "\n" && source[end] !== "\r") end++;
    let next = end;
    if (source[next] === "\r") next += source[next + 1] === "\n" ? 2 : 1;
    else if (source[next] === "\n") next++;
    lines.push({ start, end, next });
    start = next;
  }
  return lines;
}

function indentOf(source: string, line: Line, limit = Number.POSITIVE_INFINITY): Indent {
  let offset = line.start;
  let columns = 0;
  while (offset < line.end && columns < limit) {
    if (source[offset] === " ") {
      offset++;
      columns++;
      continue;
    }
    if (source[offset] === "\t") {
      const width = 4 - (columns % 4);
      if (columns + width > limit) break;
      offset++;
      columns += width;
      continue;
    }
    break;
  }
  return { offset, columns };
}

function isBlank(source: string, line: Line): boolean {
  return /^[ \t]*$/.test(source.slice(line.start, line.end));
}

function named(type: string, text: string, offset: number): Token {
  return {
    type,
    text,
    offset,
    k: 0,
    t: 0,
    newlineBefore: false,
    commentBefore: false,
    multilineFlowBefore: false,
  };
}

function structural(type: string, offset: number, text = ""): Token {
  return named(type, text, offset);
}

function lineBody(source: string, line: Line): { offset: number; text: string } | null {
  const indent = indentOf(source, line, 3);
  if (source[indent.offset] === " " || source[indent.offset] === "\t") return null;
  return { offset: indent.offset, text: source.slice(indent.offset, line.end) };
}

function htmlStartAt(source: string, line: Line): HtmlStart | null {
  const body = lineBody(source, line);
  if (!body || body.text[0] !== "<") return null;
  const lower = body.text.toLowerCase();
  for (const tag of ["script", "pre", "style", "textarea"]) {
    if (lower.startsWith(`<${tag}`) && (lower.length === tag.length + 1 || /[ \t>]/.test(lower[tag.length + 1]))) {
      return { interruptParagraph: true, terminator: `</${tag}>` };
    }
  }
  if (body.text.startsWith("<!--")) return { interruptParagraph: true, terminator: "-->" };
  if (body.text.startsWith("<?")) return { interruptParagraph: true, terminator: "?>" };
  if (body.text.startsWith("<![CDATA[")) return { interruptParagraph: true, terminator: "]]>" };
  if (body.text.startsWith("<!") && /[A-Z]/.test(body.text[2] ?? "")) return { interruptParagraph: true, terminator: ">" };

  const tag = /^<\/?([a-z][a-z0-9-]*)/i.exec(body.text)?.[1].toLowerCase();
  if (tag && htmlBlockTags.has(tag)) return { interruptParagraph: true };
  if (/^<\/?[a-z][^>]*>[ \t]*$/i.test(body.text)) return { interruptParagraph: false };
  return null;
}

function isLinkDefinition(source: string, line: Line): boolean {
  const body = lineBody(source, line)?.text;
  if (!body?.startsWith("[")) return false;
  const separator = body.indexOf("]:", 1);
  if (separator < 2 || separator > 1000) return false;
  let rest = body.slice(separator + 2).trim();
  if (!rest) return false;
  if (rest[0] === "<") {
    const close = rest.indexOf(">", 1);
    if (close < 0) return false;
    rest = rest.slice(close + 1).trim();
  }
  else {
    const whitespace = rest.search(/[ \t]/);
    rest = whitespace < 0 ? "" : rest.slice(whitespace).trim();
  }
  if (!rest) return true;
  const pairs: Record<string, string> = { "\"": "\"", "'": "'", "(": ")" };
  return rest.at(-1) === pairs[rest[0]];
}

function fenceAt(source: string, line: Line): Fence | null {
  const body = lineBody(source, line);
  if (!body || (body.text[0] !== "`" && body.text[0] !== "~")) return null;
  const marker = body.text[0] as Fence["marker"];
  let length = 0;
  while (body.text[length] === marker) length++;
  if (length < 3 || (marker === "`" && body.text.slice(length).includes("`"))) return null;
  return { marker, length };
}

function closesFence(source: string, line: Line, fence: Fence): boolean {
  const body = lineBody(source, line);
  if (!body || body.text[0] !== fence.marker) return false;
  let length = 0;
  while (body.text[length] === fence.marker) length++;
  return length >= fence.length && /^[ \t]*$/.test(body.text.slice(length));
}

function atxAt(source: string, line: Line): { markerOffset: number; marker: string; contentOffset: number; contentEnd: number } | null {
  const body = lineBody(source, line);
  if (!body) return null;
  const match = /^(#{1,6})(?:[ \t]+|$)/.exec(body.text);
  if (!match) return null;
  const contentOffset = body.offset + match[0].length;
  let contentEnd = line.end;
  while (contentEnd > contentOffset && (source[contentEnd - 1] === " " || source[contentEnd - 1] === "\t")) contentEnd--;
  let closer = contentEnd;
  while (closer > contentOffset && source[closer - 1] === "#") closer--;
  if (closer < contentEnd && (closer === contentOffset || source[closer - 1] === " " || source[closer - 1] === "\t")) {
    contentEnd = closer;
    while (contentEnd > contentOffset && (source[contentEnd - 1] === " " || source[contentEnd - 1] === "\t")) contentEnd--;
  }
  return { markerOffset: body.offset, marker: match[1], contentOffset, contentEnd };
}

function setextAt(source: string, line: Line): "=" | "-" | null {
  const body = lineBody(source, line);
  const match = body && /^(=+|-+)[ \t]*$/.exec(body.text);
  return match ? match[1][0] as "=" | "-" : null;
}

function isThematicBreak(source: string, line: Line): boolean {
  const body = lineBody(source, line);
  if (!body) return false;
  const compact = body.text.replace(/[ \t]/g, "");
  return compact.length >= 3 && /^\*+$|^-+$|^_+$/.test(compact);
}

function blockQuoteOffset(source: string, line: Line): number | null {
  const body = lineBody(source, line);
  if (!body || source[body.offset] !== ">") return null;
  let offset = body.offset + 1;
  if (source[offset] === " " || source[offset] === "\t") offset++;
  return offset;
}

function listMarkerAt(source: string, line: Line): ListMarker | null {
  const body = lineBody(source, line);
  if (!body) return null;
  const unordered = /^([-+*])(?:[ \t]+|$)/.exec(body.text);
  if (unordered && !isThematicBreak(source, line)) {
    return {
      kind: "unordered",
      offset: body.offset,
      contentOffset: body.offset + unordered[0].length,
      text: unordered[1],
    };
  }
  const ordered = /^(\d{1,9})([.)])(?:[ \t]+|$)/.exec(body.text);
  if (!ordered) return null;
  return {
    kind: "ordered",
    offset: body.offset,
    contentOffset: body.offset + ordered[0].length,
    text: ordered[1] + ordered[2],
    startNumber: Number(ordered[1]),
  };
}

function paragraphContentStart(source: string, line: Line): number {
  return indentOf(source, line, 3).offset;
}

function emitInlineChunks(source: string, lines: readonly Line[], out: Token[]): void {
  lines.forEach((line, index) => {
    const offset = paragraphContentStart(source, line);
    const end = index < lines.length - 1 ? line.next : line.end;
    if (end > offset) out.push(named("InlineChunk", source.slice(offset, end), offset));
  });
}

function emitParagraph(source: string, lines: readonly Line[], out: Token[]): void {
  if (lines.length === 0) return;
  out.push(structural("ParagraphOpen", lines[0].start));
  emitInlineChunks(source, lines, out);
  out.push(structural("ParagraphClose", lines[lines.length - 1].end));
}

function resolveLines(source: string, lines: readonly Line[], out: Token[]): void {
  let paragraph: Line[] = [];
  const flushParagraph = (): void => {
    emitParagraph(source, paragraph, out);
    paragraph = [];
  };

  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (isBlank(source, line)) {
      flushParagraph();
      index++;
      continue;
    }

    const setext = setextAt(source, line);
    if (paragraph.length > 0 && setext) {
      out.push(structural(setext === "=" ? "SetextHeading1Open" : "SetextHeading2Open", paragraph[0].start));
      emitInlineChunks(source, paragraph, out);
      out.push(structural("HeadingClose", line.end));
      paragraph = [];
      index++;
      continue;
    }

    const atx = atxAt(source, line);
    const fence = fenceAt(source, line);
    const quoteOffset = blockQuoteOffset(source, line);
    const listMarker = listMarkerAt(source, line);
    const htmlStart = htmlStartAt(source, line);
    const thematic = isThematicBreak(source, line);
    const interruptsParagraph = !!atx || !!fence || quoteOffset !== null || thematic
      || htmlStart?.interruptParagraph
      || listMarker?.kind === "unordered" || (listMarker?.kind === "ordered" && listMarker.startNumber === 1);
    if (paragraph.length > 0 && !interruptsParagraph) {
      paragraph.push(line);
      index++;
      continue;
    }
    if (paragraph.length > 0) flushParagraph();

    if (isLinkDefinition(source, line)) {
      index++;
      continue;
    }

    if (atx) {
      out.push(structural("AtxHeadingOpen", atx.markerOffset, atx.marker));
      if (atx.contentEnd > atx.contentOffset) {
        out.push(named("InlineChunk", source.slice(atx.contentOffset, atx.contentEnd), atx.contentOffset));
      }
      out.push(structural("HeadingClose", line.end));
      index++;
      continue;
    }

    if (fence) {
      let endIndex = index + 1;
      while (endIndex < lines.length && !closesFence(source, lines[endIndex], fence)) endIndex++;
      if (endIndex < lines.length) endIndex++;
      const end = lines[endIndex - 1]?.next ?? line.next;
      out.push(named("FencedCodeBlock", source.slice(line.start, end), line.start));
      index = endIndex;
      continue;
    }

    if (thematic) {
      out.push(named("ThematicBreakToken", source.slice(line.start, line.end), line.start));
      index++;
      continue;
    }

    if (htmlStart) {
      let endIndex = index + 1;
      if (htmlStart.terminator && !source.slice(line.start, line.end).toLowerCase().includes(htmlStart.terminator)) {
        while (endIndex < lines.length
          && !source.slice(lines[endIndex].start, lines[endIndex].end).toLowerCase().includes(htmlStart.terminator)) endIndex++;
        if (endIndex < lines.length) endIndex++;
      }
      else if (!htmlStart.terminator) {
        while (endIndex < lines.length && !isBlank(source, lines[endIndex])) endIndex++;
      }
      const end = lines[endIndex - 1]?.next ?? line.next;
      out.push(named("HtmlBlockToken", source.slice(line.start, end), line.start));
      index = endIndex;
      continue;
    }

    if (quoteOffset !== null) {
      const quoteLines: Line[] = [];
      const start = line.start;
      while (index < lines.length) {
        const contentOffset = blockQuoteOffset(source, lines[index]);
        if (contentOffset === null) break;
        quoteLines.push({ ...lines[index], start: contentOffset });
        index++;
      }
      out.push(structural("BlockQuoteOpen", start, ">"));
      resolveLines(source, quoteLines, out);
      out.push(structural("BlockQuoteClose", quoteLines.at(-1)?.end ?? start));
      continue;
    }

    if (listMarker) {
      const kind = listMarker.kind;
      const listOpen = kind === "ordered" ? "OrderedListOpen" : "UnorderedListOpen";
      const listClose = kind === "ordered" ? "OrderedListClose" : "UnorderedListClose";
      const itemOpen = kind === "ordered" ? "OrderedItemOpen" : "UnorderedItemOpen";
      const itemClose = kind === "ordered" ? "OrderedItemClose" : "UnorderedItemClose";
      out.push(structural(listOpen, listMarker.offset, listMarker.text));
      while (index < lines.length) {
        const marker = listMarkerAt(source, lines[index]);
        if (!marker || marker.kind !== kind) break;
        out.push(structural(itemOpen, marker.offset, marker.text));
        if (marker.contentOffset < lines[index].end) {
          resolveLines(source, [{ ...lines[index], start: marker.contentOffset }], out);
        }
        out.push(structural(itemClose, lines[index].end));
        index++;
      }
      out.push(structural(listClose, lines[index - 1].end));
      continue;
    }

    const indent = indentOf(source, line);
    if (indent.columns >= 4) {
      const start = line.start;
      let endIndex = index + 1;
      while (endIndex < lines.length && (isBlank(source, lines[endIndex]) || indentOf(source, lines[endIndex]).columns >= 4)) endIndex++;
      const end = lines[endIndex - 1].next;
      out.push(named("IndentedCodeBlockToken", source.slice(start, end), start));
      index = endIndex;
      continue;
    }

    paragraph.push(line);
    index++;
  }

  flushParagraph();
}

/** Produce the balanced structural token stream consumed by markdownBlockGrammar. */
export function tokenizeMarkdownBlocks(source: string): Token[] {
  const tokens: Token[] = [];
  resolveLines(source, linesOf(source), tokens);
  return tokens;
}
