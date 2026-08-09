import type { Code, InlineCode } from "mdast";
import {
  indentOf,
  isBlank,
  lineIndent,
  logicalToken,
} from "../../block/scanner.ts";
import { inlineTokenText } from "../../inline/runtime.ts";
import {
  appendInline,
  blockEnd,
  type BlockProjectionContext,
  blockToken,
  firstNonspace,
  lineEnd,
  normalizeLines,
  withSpan,
} from "../../mdast.ts";
import { semanticText } from "./text.ts";
import type { BlockLine, InternalSyntaxPlugin } from "../profile.ts";

interface Fence {
  marker: "`" | "~";
  length: number;
}

function fenceAt(source: string, line: BlockLine): Fence | null {
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

function closesFence(source: string, line: BlockLine, fence: Fence): boolean {
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

export const codePlugin: InternalSyntaxPlugin = {
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
        return !!fenceAt(source, line);
      },
      start(source, lines, start, out) {
        const fence = fenceAt(source, lines[start]);
        if (!fence) {
          return void 0;
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
      project(tokenIndex, sourceSpan, accumulator) {
        const { context } = accumulator;
        const text = inlineTokenText(context.view.text, context.tokens, tokenIndex);
        appendInline(
          accumulator,
          withSpan(
            { type: "inlineCode", value: codeSpanValue(text) } satisfies InlineCode,
            sourceSpan.start,
            sourceSpan.end,
          ),
          sourceSpan.start,
        );
        return true;
      },
    },
  ],
};
