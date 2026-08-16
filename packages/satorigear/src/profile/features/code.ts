import {
  closesFence,
  type Fence,
  fenceAt,
  fencedBlock,
  type FencedBlock,
  fencedBlockContent,
  type FenceRule,
} from "../../block/fence.ts";
import {
  type BlockLine,
  firstNonspace,
  indentOf,
  isBlank,
  lineEnd,
  normalizeLines,
  removeIndent,
} from "../../block/lines.ts";
import { appendLogicalToken } from "../../block/tokens.ts";
import { BlockKind, BlockRule } from "../../constants/block.ts";
import { Character } from "../../constants/character.ts";
import { InlineKind } from "../../constants/inline.ts";
import { type BlockBuildContext, blockEnd, blockToken } from "../../fragment/block.ts";
import { inlineMarkerRunEnd } from "../../inline/lexer.ts";
import { appendInlineToken, inlineTokenText } from "../../inline/tokens.ts";
import { semanticText } from "./text.ts";
import type { SyntaxFeature } from "../types.ts";

const codeFenceRule: FenceRule = {
  forbiddenInfoMarkers: "`",
  markers: "`~",
  minimumLength: 3,
};

export function codeFenceAt(source: string, line: BlockLine): Fence | undefined {
  return fenceAt(source, line, codeFenceRule);
}

function indentedCodeEnd(tokenStart: number, context: BlockBuildContext): number {
  const token = blockToken(tokenStart, BlockKind.IndentedCodeBlockToken, context);
  const count = context.structure.tokens.rangeCount(token);
  for (let index = count - 1; index >= 0; index--) {
    const start = context.structure.tokens.rangeStart(token, index);
    const rangeEnd = context.structure.tokens.rangeEnd(token, index);
    if (/[^\r\n]/.test(context.source.slice(start, rangeEnd))) {
      let end = rangeEnd;
      while (end > start && /[\r\n]/.test(context.source[end - 1])) {
        end--;
      }
      return end;
    }
  }
  throw new Error("IndentedCodeBlockToken has no source content");
}

export const feature: SyntaxFeature = {
  block: {
    fallbacks: [
      (source, lines, start, out) => {
        if (indentOf(source, lines[start]).columns < 4) {
          return;
        }
        let end = start + 1;
        while (end < lines.length && (isBlank(source, lines[end]) || indentOf(source, lines[end]).columns >= 4)) {
          end++;
        }
        appendLogicalToken(out, BlockKind.IndentedCodeBlockToken, source, lines, start, end);
        return end;
      },
    ],
    rules: [
      {
        rule: BlockRule.FencedCode,
        syntax: {
          kind: "leaf",
          token: BlockKind.FencedCodeBlock,
        },
        build(tokenStart, context) {
          const offset = context.structure.tokens.start(tokenStart);
          const end = offset + context.structure.lenOf(tokenStart);
          const token = blockToken(tokenStart, BlockKind.FencedCodeBlock, context);
          const source = normalizeLines(
            context.structure.tokens.text(context.source, token),
          );
          const block = context.structure.tokens.value<FencedBlock>(token);
          if (!block) {
            throw new Error("FencedCodeBlock token has no fence metadata");
          }
          const rawInfo = semanticText(block.info);
          const langEnd = rawInfo.search(/[ \t]/);
          const lang = rawInfo ? langEnd < 0 ? rawInfo : rawInfo.slice(0, langEnd) : null;
          const metaStart = langEnd < 0 ? -1 : rawInfo.slice(langEnd).search(/[^ \t]/);
          return {
            type: "code",
            lang,
            meta: metaStart < 0 ? null : rawInfo.slice(langEnd + metaStart),
            value: fencedBlockContent(source, block),
            position: {
              start: firstNonspace(context.source, offset, lineEnd(context.source, offset)),
              end: block.closed || end < context.source.length
                ? blockEnd(tokenStart, context)
                : end,
            },
          };
        },
      },
      {
        rule: BlockRule.IndentedCodeBlock,
        syntax: {
          kind: "leaf",
          token: BlockKind.IndentedCodeBlockToken,
        },
        build(tokenStart, context) {
          const offset = context.structure.tokens.start(tokenStart);
          const token = blockToken(tokenStart, BlockKind.IndentedCodeBlockToken, context);
          const lines = normalizeLines(context.structure.tokens.text(context.source, token))
            .split("\n")
            .map((line) => removeIndent(line, 4));
          while (lines.length && /^[ \t]*$/.test(lines[lines.length - 1])) {
            lines.pop();
          }
          return {
            type: "code",
            lang: null,
            meta: null,
            value: lines.join("\n"),
            position: { start: offset, end: indentedCodeEnd(tokenStart, context) },
          };
        },
      },
    ],
    starts: [
      {
        codes: [
          Character.GraveAccent,
          Character.Tilde,
        ],
        interrupt(source, line) {
          return !!codeFenceAt(source, line);
        },
        start(source, lines, start, out) {
          const fence = codeFenceAt(source, lines[start]);
          if (!fence) {
            return;
          }
          let end = start + 1;
          while (end < lines.length && !closesFence(source, lines[end], fence)) {
            end++;
          }
          const closed = end < lines.length;
          if (end < lines.length) {
            end++;
          }
          appendLogicalToken(
            out,
            BlockKind.FencedCodeBlock,
            source,
            lines,
            start,
            end,
            fencedBlock(source, lines[start], fence, closed),
          );
          return end;
        },
      },
    ],
  },
  inline: {
    lexical: [
      {
        marker: Character.GraveAccent,
        scan(source, start, tokens) {
          let end = -1;
          if (source.charCodeAt(start - 1) !== Character.GraveAccent) {
            const openEnd = inlineMarkerRunEnd(source, start);
            const markerLength = openEnd - start;
            let offset = openEnd;
            while (offset < source.length) {
              if (source.charCodeAt(offset) !== Character.GraveAccent) {
                offset++;
                continue;
              }
              const closeEnd = inlineMarkerRunEnd(source, offset);
              if (closeEnd - offset === markerLength) {
                end = closeEnd;
                break;
              }
              offset = closeEnd;
            }
          }
          if (end < 0) {
            end = start + 1;
          }
          appendInlineToken(
            tokens,
            end === start + 1 ? InlineKind.Delimiter : InlineKind.CodeSpan,
            start,
            end,
          );
          return end;
        },
      },
    ],
    syntax: [
      {
        kind: "leaf",
        token: InlineKind.CodeSpan,
        build: (tokenIndex, sourceSpan, context) => {
          const text = inlineTokenText(context.view.text, context.tokens, tokenIndex);
          const markerLength = /^`+/.exec(text)?.[0].length;
          if (!markerLength) {
            throw new Error("CodeSpan token does not start with a backtick run");
          }
          let value = normalizeLines(text.slice(markerLength, -markerLength));
          if (/^[ \n]/.test(value) && /[ \n]$/.test(value) && /[^ \n]/.test(value)) {
            value = value.slice(1, -1);
          }
          return {
            type: "inlineCode",
            value: context.blockRule === BlockRule.TableCell
              ? value.replace(/\\\|/g, "|")
              : value,
            position: sourceSpan,
          };
        },
      },
    ],
  },
};
