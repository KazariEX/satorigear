import type { Code, InlineCode } from "mdast";
import {
  type BlockLine,
  indentOf,
  isBlank,
  lineIndent,
  logicalToken,
  removeIndent,
} from "../../block/primitives.ts";
import { inlineTokenText } from "../../inline/runtime.ts";
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

export interface CodeFence {
  marker: "`" | "~";
  length: number;
}

export function codeFenceAt(source: string, line: BlockLine): CodeFence | null {
  const indent = lineIndent(source, line);
  if (!indent) {
    return null;
  }
  const marker = source[indent.offset];
  if (marker !== "`" && marker !== "~") {
    return null;
  }
  const body = source.slice(indent.offset, line.end);
  let length = 0;
  while (body[length] === marker) {
    length++;
  }
  if (length < 3 || (marker === "`" && body.slice(length).includes("`"))) {
    return null;
  }
  return { marker, length };
}

export function closesCodeFence(source: string, line: BlockLine, fence: CodeFence): boolean {
  const indent = lineIndent(source, line);
  if (!indent || source[indent.offset] !== fence.marker) {
    return false;
  }
  const body = source.slice(indent.offset, line.end);
  let length = 0;
  while (body[length] === fence.marker) {
    length++;
  }
  return length >= fence.length && /^[ \t]*$/.test(body.slice(length));
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
    sourceSpan.start,
  );
  return true;
}

// Content loses at most the opening indent, so scan only those leading columns instead of replacing every line.
function fencedCodeContent(source: string, start: number, end: number, indent: number): string {
  const contentEnd = source.charCodeAt(end - 1) === 10 ? end - 1 : end;
  if (!indent) {
    return source.slice(start, contentEnd);
  }

  const chunks: string[] = [];
  let lineStart = start;
  while (lineStart < contentEnd) {
    const newline = source.indexOf("\n", lineStart);
    const lineEnd = newline < 0 || newline >= contentEnd ? contentEnd : newline;
    let contentStart = lineStart;
    while (contentStart - lineStart < indent && source.charCodeAt(contentStart) === 32) {
      contentStart++;
    }
    chunks.push(source.slice(contentStart, lineEnd));
    if (lineEnd < contentEnd) {
      chunks.push("\n");
    }
    lineStart = lineEnd + 1;
  }
  return chunks.join("");
}

function fencedCode(value: string): { closed: boolean; node: Code } {
  const source = normalizeLines(value);
  if (!source) {
    throw new Error("FencedCodeBlock token is empty");
  }

  const openingEnd = source.indexOf("\n");
  const opening = source.slice(0, openingEnd < 0 ? source.length : openingEnd);
  const contentStart = openingEnd < 0 ? source.length : openingEnd + 1;
  let indent = 0;
  while (indent < 3 && opening.charCodeAt(indent) === 32) {
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

  const finalLineEnd = source.endsWith("\n") ? source.length - 1 : source.length;
  const finalLineStart = source.lastIndexOf("\n", finalLineEnd - 1) + 1;
  const closing = source.slice(finalLineStart, finalLineEnd);
  let closingIndent = 0;
  while (closingIndent < 3 && closing.charCodeAt(closingIndent) === 32) {
    closingIndent++;
  }
  let closingMarkerEnd = closingIndent;
  while (closing[closingMarkerEnd] === marker) {
    closingMarkerEnd++;
  }
  let closingEnd = closingMarkerEnd;
  while (closingEnd < closing.length) {
    const code = closing.charCodeAt(closingEnd);
    if (code !== 32 && code !== 9) {
      break;
    }
    closingEnd++;
  }
  const closed = finalLineStart >= contentStart
    && closingMarkerEnd - closingIndent >= markerLength
    && closingEnd === closing.length;

  const rawInfo = semanticText(opening.slice(markerEnd).replace(/^[ \t]+/, ""));
  const langEnd = rawInfo.search(/[ \t]/);
  const lang = rawInfo ? langEnd < 0 ? rawInfo : rawInfo.slice(0, langEnd) : null;
  const metaStart = langEnd < 0 ? -1 : rawInfo.slice(langEnd).search(/[^ \t]/);
  return {
    closed,
    node: {
      type: "code",
      lang,
      meta: metaStart < 0 ? null : rawInfo.slice(langEnd + metaStart),
      value: fencedCodeContent(source, contentStart, closed ? finalLineStart : source.length, indent),
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
        return void 0;
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
          return void 0;
        }
        let end = start + 1;
        while (end < lines.length && !closesCodeFence(source, lines[end], fence)) {
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
