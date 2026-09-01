import { htmlBlockNames, htmlRawNames } from "micromark-util-html-tag-name";
import { type BlockLines, isBlankLine } from "../../block/lines.ts";
import { appendLogicalToken } from "../../block/tokens.ts";
import { BlockKind } from "../../constants/block.ts";
import { Character } from "../../constants/character.ts";
import { InlineKind } from "../../constants/inline.ts";
import { blockEnd } from "../../fragment/block.ts";
import { matchInlinePatternEnd } from "../../inline/lexer.ts";
import { appendInlineToken, inlineTokenText } from "../../inline/tokens.ts";
import type { InlineLeafBuilder } from "../../fragment/inline.ts";
import type { SyntaxFeature } from "../types.ts";

interface HtmlStart {
  interruptParagraph: boolean;
  terminator?: string;
}

const htmlBlockTags = new Set(htmlBlockNames);
const htmlTagName = "[a-z][a-z0-9-]*";
const htmlAttributeName = "[a-z_:][\\w.:-]*";
const htmlUnquotedValue = `[^\\s"'=<>\`]+`;
const htmlAttributeValue = `(?:${htmlUnquotedValue}|'[^']*'|"[^"]*")`;
const htmlAttribute = `\\s+${htmlAttributeName}(?:\\s*=\\s*${htmlAttributeValue})?`;
const completeHtmlTag = new RegExp(`^(?:<${htmlTagName}(?:${htmlAttribute})*\\s*/?>|</${htmlTagName}\\s*>)[ \\t]*$`, "i");
const htmlComment = /<!-->|<!--->|<!--[\s\S]*?(?:-->|$)/y;
const autolink = /<(?:[A-Z][A-Z0-9+.\-]{1,31}:[^ \t\n\r<>]+|[\w!#$%&'*+\-/=?^`{|}~.]+@[A-Z0-9](?:[A-Z0-9]|-(?=[A-Z0-9]))*(?:\.[A-Z0-9](?:[A-Z0-9]|-(?=[A-Z0-9]))*)+)>/iy;
const inlineHtml = /<[A-Za-z][A-Za-z0-9-]*(?:[ \t\n\r]+[A-Za-z_:][\w.:-]*(?:[ \t\n\r]*=[ \t\n\r]*(?:[^ \t\n\r"'=<>`]+|'[^']*'|"[^"]*"))?)*[ \t\n\r]*\/?>|<\/[A-Za-z][A-Za-z0-9-]*[ \t\n\r]*>|<\?[\s\S]*?\?>|<![A-Z][\s\S]*?>|<!\[CDATA\[[\s\S]*?\]\]>/y;

function htmlStartAt(
  source: string,
  lines: BlockLines,
  index: number,
  contentOffset: number,
): HtmlStart | undefined {
  const body = source.slice(contentOffset, lines.end(index));
  const lower = body.toLowerCase();
  for (const tag of htmlRawNames) {
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

const buildInlineHtml: InlineLeafBuilder = (tokenIndex, sourceSpan, context) => {
  const text = inlineTokenText(context.view.text, context.tokens, tokenIndex);
  return {
    type: "html",
    value: text,
    position: sourceSpan,
  };
};

export const feature: SyntaxFeature = {
  block: {
    builds: [
      {
        token: BlockKind.HtmlBlock,
        build(tokenStart, context) {
          const tokens = context.structure.tokens;
          const offset = tokens.start(tokenStart);
          const end = tokens.end(tokenStart);
          // The HTML scanner records termination state on every emitted block token.
          const unterminated = tokens.value<boolean>(tokenStart)!;
          let html = context.locator.normalizeLineEndings(
            tokens.text(context.source, tokenStart),
          );
          if (!unterminated && html.endsWith("\n")) {
            html = html.slice(0, -1);
          }
          return {
            type: "html",
            value: html,
            position: context.locator.positionAt(
              offset,
              html.endsWith("\n") ? end : blockEnd(tokenStart, context),
            ),
          };
        },
      },
    ],
    starts: [
      {
        codes: [
          Character.LessThanSign,
        ],
        interrupt(source, lines, index, contentOffset) {
          return !!htmlStartAt(source, lines, index, contentOffset)?.interruptParagraph;
        },
        start(source, lines, start, contentOffset, out) {
          const htmlStart = htmlStartAt(source, lines, start, contentOffset);
          if (!htmlStart) {
            return;
          }
          let end = start + 1;
          let unterminated = false;
          if (
            htmlStart.terminator &&
            !source.slice(lines.start(start), lines.end(start)).toLowerCase().includes(htmlStart.terminator)
          ) {
            while (
              end < lines.length &&
              !source.slice(lines.start(end), lines.end(end)).toLowerCase().includes(htmlStart.terminator)
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
            while (end < lines.length && !isBlankLine(source, lines, end)) {
              end++;
            }
          }
          appendLogicalToken(out, BlockKind.HtmlBlock, source, lines, start, end, unterminated);
          return end;
        },
      },
    ],
  },
  inline: {
    scans: [
      {
        marker: Character.LessThanSign,
        scan(source, start, tokens) {
          let end = matchInlinePatternEnd(htmlComment, source, start);
          let kind = InlineKind.HtmlComment;
          if (end < 0) {
            end = matchInlinePatternEnd(autolink, source, start);
            kind = InlineKind.Autolink;
          }
          if (end < 0) {
            end = matchInlinePatternEnd(inlineHtml, source, start);
            kind = InlineKind.InlineHtml;
          }
          if (end < 0) {
            return start + 1;
          }
          appendInlineToken(tokens, kind, start, end);
          return end;
        },
      },
    ],
    builds: [
      { kind: "leaf", token: InlineKind.InlineHtml, build: buildInlineHtml },
      { kind: "leaf", token: InlineKind.HtmlComment, build: buildInlineHtml },
    ],
  },
};
