import type { Html } from "mdast";
import { isBlank, lineIndent, logicalToken } from "../../block/scanner.ts";
import { inlineTokenText } from "../../inline/runtime.ts";
import {
  appendInline,
  blockEnd,
  type BlockProjector,
  blockToken,
  type InlineLeafProjector,
  normalizeLines,
  withSpan,
} from "../../mdast.ts";
import type { BlockLine, BlockStart } from "../profile.ts";

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
const htmlTagName = "[a-z][a-z0-9-]*";
const htmlAttributeName = "[a-z_:][\\w.:-]*";
const htmlUnquotedValue = `[^\\s"'=<>\`]+`;
const htmlAttributeValue = `(?:${htmlUnquotedValue}|'[^']*'|"[^"]*")`;
const htmlAttribute = `\\s+${htmlAttributeName}(?:\\s*=\\s*${htmlAttributeValue})?`;
const completeHtmlTag = new RegExp(`^(?:<${htmlTagName}(?:${htmlAttribute})*\\s*/?>|</${htmlTagName}\\s*>)[ \\t]*$`, "i");

function htmlStartAt(source: string, line: BlockLine): HtmlStart | null {
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

export function htmlBlockInterrupt(source: string, line: BlockLine): boolean {
  return !!htmlStartAt(source, line)?.interruptParagraph;
}

export const htmlBlockStart: BlockStart = (source, lines, start, out) => {
  const line = lines[start];
  const htmlStart = htmlStartAt(source, line);
  if (!htmlStart) {
    return void 0;
  }
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
};

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

export const projectInlineHtml: InlineLeafProjector = (tokenIndex, sourceSpan, accumulator) => {
  const { context } = accumulator;
  const text = inlineTokenText(context.view.text, context.tokens, tokenIndex);
  appendInline(
    accumulator,
    withSpan({ type: "html", value: text } satisfies Html, sourceSpan.start, sourceSpan.end),
    sourceSpan.start,
  );
  return true;
};

export const projectHtmlBlock: BlockProjector = (nodeId, offset, tokenBase, context) => {
  const end = offset + context.view.arena.lenOf(nodeId);
  const html = htmlBlockValue(blockToken(nodeId, tokenBase, "HtmlBlockToken", context).text);
  return withSpan(
    { type: "html", value: html } satisfies Html,
    offset,
    html.endsWith("\n") ? end : blockEnd(nodeId, offset, context),
  );
};
