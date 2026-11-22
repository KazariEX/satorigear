import { htmlBlockNames, htmlRawNames } from "micromark-util-html-tag-name";
import { type BlockLines, isBlankLine } from "../../block/lines.ts";
import { appendLogicalToken } from "../../block/tokens.ts";
import { BlockKind } from "../../constants/block.ts";
import { Character } from "../../constants/character.ts";
import { InlineKind } from "../../constants/inline.ts";
import { matchInlinePatternEnd } from "../../inline/tokenizer.ts";
import { appendInlineToken, inlineTokenText } from "../../inline/tokens.ts";
import { isAsciiLetter } from "../utils.ts";
import type { SyntaxFeature } from "../types.ts";

interface HtmlStart {
  interruptParagraph: boolean;
  terminator?: string;
}

const htmlBlockTags = new Set(htmlBlockNames);
const htmlRawTags = new Set(htmlRawNames);
const htmlTagName = "[a-z][a-z0-9-]*";
const htmlAttributeName = "[a-z_:][\\w.:-]*";
const htmlUnquotedValue = `[^\\s"'=<>\`]+`;
const htmlAttributeValue = `(?:${htmlUnquotedValue}|'[^']*'|"[^"]*")`;
const htmlAttribute = `\\s+${htmlAttributeName}(?:\\s*=\\s*${htmlAttributeValue})?`;
const htmlTag = /^<\/?([a-z][a-z0-9-]*)(?=[ \t\n\r/>]|$)/i;
const htmlTagDelimiter = /[ \t>]/;
const completeHtmlTag = new RegExp(`^(?:<${htmlTagName}(?:${htmlAttribute})*\\s*/?>|</${htmlTagName}\\s*>)[ \\t]*$`, "i");
const htmlComment = /<!--(?:-?>|.*?-->|.*)/sy;
const autolink = /<(?:[A-Z][A-Z0-9+.\-]{1,31}:[^ \t\n\r<>]+|[\w!#$%&'*+\-/=?^`{|}~.]+@[A-Z0-9](?:[A-Z0-9]|-(?=[A-Z0-9]))*(?:\.[A-Z0-9](?:[A-Z0-9]|-(?=[A-Z0-9]))*)+)>/iy;
const inlineHtml = /<[A-Za-z][A-Za-z0-9-]*(?:[ \t\n\r]+[A-Za-z_:][\w.:-]*(?:[ \t\n\r]*=[ \t\n\r]*(?:[^ \t\n\r"'=<>`]+|'[^']*'|"[^"]*"))?)*[ \t\n\r]*\/?>|<\/[A-Za-z][A-Za-z0-9-]*[ \t\n\r]*>|<\?[\s\S]*?\?>|<![A-Za-z][\s\S]*?>|<!\[CDATA\[[\s\S]*?\]\]>/y;

function htmlStartAt(
  source: string,
  lines: BlockLines,
  index: number,
  contentOffset: number,
): HtmlStart | undefined {
  const body = source.slice(contentOffset, lines.end(index));
  switch (body.charCodeAt(1)) {
    case Character.QuestionMark: {
      return { interruptParagraph: true, terminator: "?>" };
    }
    case Character.ExclamationMark: {
      if (body.startsWith("<!--")) {
        return { interruptParagraph: true, terminator: "-->" };
      }
      if (body.startsWith("<![CDATA[")) {
        return { interruptParagraph: true, terminator: "]]>" };
      }
      if (isAsciiLetter(body.charCodeAt(2))) {
        return { interruptParagraph: true, terminator: ">" };
      }
      break;
    }
  }
  const tag = htmlTag.exec(body)?.[1].toLowerCase();
  if (
    tag && body[1] !== "/" && htmlRawTags.has(tag) && (
      body.length === tag.length + 1 || htmlTagDelimiter.test(body[tag.length + 1])
    )
  ) {
    return { interruptParagraph: true, terminator: `</${tag}>` };
  }
  if (tag && htmlBlockTags.has(tag)) {
    return { interruptParagraph: true };
  }
  if (completeHtmlTag.test(body)) {
    return { interruptParagraph: false };
  }
}

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
              html.endsWith("\n") ? end : tokens.contentEnd(context.source, tokenStart),
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
        start(source, lines, tokens, start, contentOffset) {
          const htmlStart = htmlStartAt(source, lines, start, contentOffset);
          if (!htmlStart) {
            return;
          }
          let end = start;
          let unterminated = false;
          if (htmlStart.terminator) {
            while (
              end < lines.length &&
              !source.slice(lines.start(end), lines.end(end)).toLowerCase().includes(htmlStart.terminator)
            ) {
              end++;
            }
            if (end === lines.length) {
              unterminated = true;
            }
            else {
              end++;
            }
          }
          else {
            end++;
            while (end < lines.length && !isBlankLine(source, lines, end)) {
              end++;
            }
          }
          appendLogicalToken(source, lines, tokens, BlockKind.HtmlBlock, start, end, unterminated);
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
          let end = matchInlinePatternEnd(source, start, htmlComment);
          let kind = InlineKind.InlineHtml;
          if (end < 0) {
            end = matchInlinePatternEnd(source, start, autolink);
            kind = InlineKind.Autolink;
          }
          if (end < 0) {
            end = matchInlinePatternEnd(source, start, inlineHtml);
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
      {
        kind: "leaf",
        token: InlineKind.InlineHtml,
        build(tokenIndex, position, context) {
          const text = inlineTokenText(context.view.text, context.tokens, tokenIndex);
          return {
            type: "html",
            value: text,
            position,
          };
        },
      },
    ],
  },
};
