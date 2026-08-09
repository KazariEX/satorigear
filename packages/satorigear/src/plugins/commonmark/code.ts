import type { Code, InlineCode } from "mdast";
import { inlineTokenText } from "../../inline/runtime.ts";
import {
  appendInline,
  blockEnd,
  type BlockProjectionContext,
  type BlockProjector,
  blockToken,
  firstNonspace,
  type InlineLeafProjector,
  lineEnd,
  normalizeLines,
  withSpan,
} from "../../mdast.ts";
import { semanticText } from "./text.ts";

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

function fencedCode(value: string): { closed: boolean; node: Code } {
  const source = normalizeLines(value);
  const lines = source.match(/[^\n]*(?:\n|$)/g)?.filter(Boolean);
  if (!lines?.length) {
    throw new Error("FencedCodeBlock token is empty");
  }
  const opening = lines[0];
  const contentLines = lines.slice(1);
  let indent = 0;
  while (indent < 3 && opening[indent] === " ") {
    indent++;
  }
  const marker = opening[indent];
  if (marker !== "`" && marker !== "~") {
    throw new Error("FencedCodeBlock token has no opening fence");
  }
  let markerEnd = indent;
  while (opening[markerEnd] === marker) {
    markerEnd++;
  }
  const markerLength = markerEnd - indent;
  const closing = contentLines.at(-1);
  const closed = Boolean(closing && new RegExp(`^ {0,3}\\${marker}{${markerLength},}[ \\t]*(?:\\n|$)`).test(closing));
  if (closed) {
    contentLines.pop();
  }
  const literal = contentLines.map((line) => line.replace(new RegExp(`^ {0,${indent}}`), "").replace(/\n?$/, "\n")).join("");
  const rawInfo = semanticText(opening.slice(markerEnd).replace(/^[ \t]+/, "").replace(/\n$/, ""));
  const langEnd = rawInfo.search(/[ \t]/);
  const lang = rawInfo ? langEnd < 0 ? rawInfo : rawInfo.slice(0, langEnd) : null;
  const metaStart = langEnd < 0 ? -1 : rawInfo.slice(langEnd).search(/[^ \t]/);
  return {
    closed,
    node: {
      type: "code",
      lang,
      meta: metaStart < 0 ? null : rawInfo.slice(langEnd + metaStart),
      value: literal.replace(/\n$/, ""),
    },
  };
}

function removeIndent(value: string, columns: number): string {
  let offset = 0;
  let consumed = 0;
  while (offset < value.length && consumed < columns) {
    if (value[offset] === " ") {
      consumed++;
    }
    else if (value[offset] === "\t") {
      consumed += 4 - (consumed % 4);
    }
    else {
      break;
    }
    offset++;
  }
  return " ".repeat(Math.max(0, consumed - columns)) + value.slice(offset);
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

export const projectInlineCode: InlineLeafProjector = (tokenIndex, sourceSpan, accumulator) => {
  const { context } = accumulator;
  const text = inlineTokenText(context.view.text, context.tokens, tokenIndex);
  appendInline(
    accumulator,
    withSpan({ type: "inlineCode", value: codeSpanValue(text) } satisfies InlineCode, sourceSpan.start, sourceSpan.end),
    sourceSpan.start,
  );
  return true;
};

export const projectFencedCode: BlockProjector = (nodeId, offset, tokenBase, context) => {
  const end = offset + context.view.arena.lenOf(nodeId);
  const fence = fencedCode(blockToken(nodeId, tokenBase, "FencedCodeBlock", context).text);
  const codeEnd = fence.closed || end < context.source.length ? blockEnd(nodeId, offset, context) : end;
  return withSpan(
    fence.node,
    firstNonspace(context.source, offset, lineEnd(context.source, offset)),
    codeEnd,
  );
};

export const projectIndentedCode: BlockProjector = (nodeId, offset, tokenBase, context) => withSpan(
  indentedCode(blockToken(nodeId, tokenBase, "IndentedCodeBlockToken", context).text),
  offset,
  indentedCodeEnd(nodeId, tokenBase, context),
);
