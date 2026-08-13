import { BlockKind } from "../../block/kinds.ts";
import { type BlockLine, isBlank, lineIndent } from "../../block/lines.ts";
import { appendLogicalToken } from "../../block/tokens.ts";
import {
  type BlockBuildContext,
  blockEnd,
  blockToken,
  normalizeLines,
} from "../../fragment/block.ts";
import { appendInline, type InlineLeafBuilder } from "../../fragment/inline.ts";
import { InlineKind } from "../../inline/kinds.ts";
import { inlineTokenText } from "../../inline/tokens.ts";
import type { SyntaxFeature } from "../types.ts";

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

function htmlStartAt(source: string, line: BlockLine): HtmlStart | undefined {
  const indent = lineIndent(source, line);
  if (!indent || source[indent.offset] !== "<") {
    return;
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
}

function htmlBlockUnterminated(token: number, context: BlockBuildContext): boolean {
  const result = context.arena.tokens.value<boolean>(token);
  if (context.arena.tokens.kind(token) !== BlockKind.HtmlBlockToken || result === void 0) {
    throw new Error("Expected HtmlBlockToken to contain its termination state");
  }
  return result;
}

const buildInlineHtml: InlineLeafBuilder = (tokenIndex, sourceSpan, accumulator) => {
  const { context } = accumulator;
  const text = inlineTokenText(context.view.text, context.tokens, tokenIndex);
  appendInline(
    accumulator,
    { type: "html", value: text, position: sourceSpan },
  );
  return true;
};

export const feature: SyntaxFeature = {
  block: {
    rules: [
      {
        rule: "HtmlBlock",
        syntax: {
          kind: "leaf",
          token: BlockKind.HtmlBlockToken,
        },
        build(nodeId, offset, tokenBase, context) {
          const end = offset + context.arena.lenOf(nodeId);
          const token = blockToken(nodeId, tokenBase, BlockKind.HtmlBlockToken, context);
          const unterminated = htmlBlockUnterminated(token, context);
          let html = normalizeLines(context.arena.tokens.text(context.source, token));
          if (!unterminated && html.endsWith("\n")) {
            html = html.slice(0, -1);
          }
          return {
            type: "html",
            value: html,
            position: {
              start: offset,
              end: html.endsWith("\n") ? end : blockEnd(nodeId, offset, context),
            },
          };
        },
      },
    ],
    starts: [
      {
        codes: [60],
        interrupt(source, line) {
          return !!htmlStartAt(source, line)?.interruptParagraph;
        },
        start(source, lines, start, out) {
          const line = lines[start];
          const htmlStart = htmlStartAt(source, line);
          if (!htmlStart) {
            return;
          }
          let end = start + 1;
          let unterminated = false;
          if (htmlStart.terminator && !source.slice(line.start, line.end).toLowerCase().includes(htmlStart.terminator)) {
            while (
              end < lines.length &&
              !source.slice(lines[end].start, lines[end].end).toLowerCase().includes(htmlStart.terminator)
            ) {
              end++;
            }
            if (end < lines.length) {
              end++;
            }
            else {
              unterminated = true;
            }
          }
          else if (!htmlStart.terminator) {
            while (end < lines.length && !isBlank(source, lines[end])) {
              end++;
            }
          }
          appendLogicalToken(out, BlockKind.HtmlBlockToken, source, lines, start, end, unterminated);
          return end;
        },
      },
    ],
  },
  inline: {
    syntax: [
      { kind: "leaf", token: InlineKind.InlineHtml, build: buildInlineHtml },
      { kind: "leaf", token: InlineKind.HtmlComment, build: buildInlineHtml },
    ],
  },
};
