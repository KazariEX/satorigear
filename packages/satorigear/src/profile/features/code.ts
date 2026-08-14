import {
  closesFence,
  type Fence,
  fenceAt,
  fencedBlockContent,
  type FenceRule,
  readFencedBlock,
} from "../../block/fence.ts";
import { BlockKind } from "../../block/kinds.ts";
import { type BlockLine, indentOf, isBlank, removeIndent } from "../../block/lines.ts";
import { appendLogicalToken } from "../../block/tokens.ts";
import {
  type BlockBuildContext,
  blockEnd,
  blockToken,
  firstNonspace,
  normalizeLines,
} from "../../fragment/block.ts";
import { appendInline, type InlineLeafBuilder, lineEnd } from "../../fragment/inline.ts";
import { InlineKind } from "../../inline/kinds.ts";
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

export const buildInlineCode: InlineLeafBuilder = (tokenIndex, sourceSpan, accumulator) => {
  const { context } = accumulator;
  const text = inlineTokenText(context.view.text, context.tokens, tokenIndex);
  const value = codeSpanValue(text);
  appendInline(
    accumulator,
    {
      type: "inlineCode",
      value: context.blockRule === "TableCell"
        ? value.replace(/\\\|/g, "|")
        : value,
      position: sourceSpan,
    },
  );
  return true;
};

function indentedCodeEnd(nodeId: number, tokenBase: number, context: BlockBuildContext): number {
  const token = blockToken(nodeId, tokenBase, BlockKind.IndentedCodeBlockToken, context);
  const count = context.arena.tokens.rangeCount(token);
  for (let index = count - 1; index >= 0; index--) {
    const start = context.arena.tokens.rangeStart(token, index);
    const rangeEnd = context.arena.tokens.rangeEnd(token, index);
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
        rule: "FencedCode",
        syntax: {
          kind: "leaf",
          token: BlockKind.FencedCodeBlock,
        },
        build(nodeId, offset, tokenBase, context) {
          const end = offset + context.arena.lenOf(nodeId);
          const source = normalizeLines(
            context.arena.tokens.text(
              context.source,
              blockToken(nodeId, tokenBase, BlockKind.FencedCodeBlock, context),
            ),
          );
          const block = readFencedBlock(source, codeFenceRule);
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
                ? blockEnd(nodeId, offset, context)
                : end,
            },
          };
        },
      },
      {
        rule: "IndentedCodeBlock",
        syntax: {
          kind: "leaf",
          token: BlockKind.IndentedCodeBlockToken,
        },
        build(nodeId, offset, tokenBase, context) {
          const token = blockToken(nodeId, tokenBase, BlockKind.IndentedCodeBlockToken, context);
          const lines = normalizeLines(context.arena.tokens.text(context.source, token))
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
            position: { start: offset, end: indentedCodeEnd(nodeId, tokenBase, context) },
          };
        },
      },
    ],
    starts: [
      {
        codes: [96, 126],
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
          if (end < lines.length) {
            end++;
          }
          appendLogicalToken(out, BlockKind.FencedCodeBlock, source, lines, start, end);
          return end;
        },
      },
    ],
  },
  inline: {
    lexical: [
      {
        marker: "`",
        scan(source, start, tokens) {
          let end = -1;
          if (source.charCodeAt(start - 1) !== 96) {
            const openEnd = inlineMarkerRunEnd(source, start);
            const markerLength = openEnd - start;
            let offset = openEnd;
            while (offset < source.length) {
              if (source.charCodeAt(offset) !== 96) {
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
        build: buildInlineCode,
      },
    ],
  },
};
