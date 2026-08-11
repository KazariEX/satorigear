import type { Code, InlineCode } from "mdast";
import {
  closesFence,
  type Fence,
  fenceAt,
  fencedBlockContent,
  type FenceRule,
  readFencedBlock,
} from "../../block/fence.ts";
import { type BlockLine, indentOf, isBlank, removeIndent } from "../../block/lines.ts";
import { logicalToken } from "../../block/tokens.ts";
import { inlineTokenText } from "../../inline/tokens.ts";
import {
  appendInline,
  blockEnd,
  type BlockProjectionContext,
  blockToken,
  firstNonspace,
  type InlineAccumulator,
  lineEnd,
  normalizeLines,
  withSpan,
} from "../../mdast.ts";
import { semanticText } from "./text.ts";
import type { SourceSpan } from "../../source-view.ts";
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

export function projectCodeSpan(
  tokenIndex: number,
  sourceSpan: SourceSpan,
  accumulator: InlineAccumulator,
  decodeTablePipe = false,
): boolean {
  const { context } = accumulator;
  const text = inlineTokenText(context.view.text, context.tokens, tokenIndex);
  const value = codeSpanValue(text);
  appendInline(
    accumulator,
    withSpan<InlineCode>(
      {
        type: "inlineCode",
        value: decodeTablePipe ? value.replace(/\\\|/g, "|") : value,
      },
      sourceSpan.start,
      sourceSpan.end,
    ),
  );
  return true;
}

function fencedCode(value: string): { closed: boolean; node: Code } {
  const source = normalizeLines(value);
  const block = readFencedBlock(source, codeFenceRule);
  const rawInfo = semanticText(block.info);
  const langEnd = rawInfo.search(/[ \t]/);
  const lang = rawInfo ? langEnd < 0 ? rawInfo : rawInfo.slice(0, langEnd) : null;
  const metaStart = langEnd < 0 ? -1 : rawInfo.slice(langEnd).search(/[^ \t]/);
  return {
    closed: block.closed,
    node: {
      type: "code",
      lang,
      meta: metaStart < 0 ? null : rawInfo.slice(langEnd + metaStart),
      value: fencedBlockContent(source, block),
    },
  };
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

function indentedCodeEnd(nodeId: number, tokenBase: number, context: BlockProjectionContext): number {
  const token = blockToken(nodeId, tokenBase, "IndentedCodeBlockToken", context);
  const spans = token.ranges ?? [{ offset: token.offset, end: token.offset + token.text.length }];
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

export const feature: SyntaxFeature = {
  blockFallbacks: [
    (source, lines, start, out) => {
      if (indentOf(source, lines[start]).columns < 4) {
        return;
      }
      let end = start + 1;
      while (end < lines.length && (isBlank(source, lines[end]) || indentOf(source, lines[end]).columns >= 4)) {
        end++;
      }
      out.push(logicalToken("IndentedCodeBlockToken", source, lines, start, end));
      return end;
    },
  ],
  blockRules: [
    {
      rule: "FencedCode",
      syntax: {
        kind: "leaf",
        token: "FencedCodeBlock",
      },
      project(nodeId, offset, tokenBase, context) {
        const end = offset + context.view.arena.lenOf(nodeId);
        const fence = fencedCode(blockToken(nodeId, tokenBase, "FencedCodeBlock", context).text);
        const codeEnd = fence.closed || end < context.source.length ? blockEnd(nodeId, offset, context) : end;
        return withSpan(
          fence.node,
          firstNonspace(context.source, offset, lineEnd(context.source, offset)),
          codeEnd,
        );
      },
    },
    {
      rule: "IndentedCodeBlock",
      syntax: {
        kind: "leaf",
        token: "IndentedCodeBlockToken",
      },
      project(nodeId, offset, tokenBase, context) {
        return withSpan(
          indentedCode(blockToken(nodeId, tokenBase, "IndentedCodeBlockToken", context).text),
          offset,
          indentedCodeEnd(nodeId, tokenBase, context),
        );
      },
    },
  ],
  blockStarts: [
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
        out.push(logicalToken("FencedCodeBlock", source, lines, start, end));
        return end;
      },
    },
  ],
  inlineTokens: [
    {
      token: "CodeSpan",
      project: projectCodeSpan,
    },
  ],
};
