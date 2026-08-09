import type { Html } from "mdast";
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
