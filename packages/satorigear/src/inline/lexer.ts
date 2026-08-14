import { InlineKind } from "./kinds.ts";
import type { InlineTokenStream } from "./tokens.ts";

type InlineLexicalScanner = (
  source: string,
  start: number,
  tokens: number[],
) => number;

// Features own marker recognition; the compiled lexer only dispatches scanners.
export interface InlineLexicalRule {
  marker: string;
  scan: InlineLexicalScanner;
}

export type InlineTokenizer = (source: string) => InlineTokenStream;

export function matchInlinePatternEnd(pattern: RegExp, source: string, start: number): number {
  pattern.lastIndex = start;
  const match = pattern.exec(source);
  return match === null ? -1 : start + match[0].length;
}

export function inlineMarkerRunEnd(source: string, start: number): number {
  const marker = source.charCodeAt(start);
  let end = start + 1;
  while (source.charCodeAt(end) === marker) {
    end++;
  }
  return end;
}

function inlineTextEnd(source: string, start: number, boundary: RegExp): number {
  boundary.lastIndex = start;
  let match = boundary.exec(source);
  while (match !== null && source.charCodeAt(match.index) === 92) {
    const next = source.charCodeAt(match.index + 1);
    if (next !== 32 && next !== 9) {
      break;
    }
    boundary.lastIndex = match.index + 2;
    match = boundary.exec(source);
  }
  return match?.index ?? source.length;
}

function tokenize(
  source: string,
  textBoundary: RegExp,
  lexicalByCode: readonly (InlineLexicalScanner | undefined)[],
): InlineTokenStream {
  const tokens: number[] = [];
  let offset = 0;
  let lineStart = true;
  while (offset < source.length) {
    if (lineStart) {
      let content = offset;
      while (source.charCodeAt(content) === 32) {
        content++;
      }
      if (content === source.length) {
        break;
      }
      let code = source.charCodeAt(content);
      if (code === 10 || code === 13) {
        offset = content + 1;
        if (code === 13 && source.charCodeAt(offset) === 10) {
          offset++;
        }
        continue;
      }
      if (code === 9) {
        let blankEnd = content;
        while (source.charCodeAt(blankEnd) === 9 || source.charCodeAt(blankEnd) === 32) {
          blankEnd++;
        }
        code = source.charCodeAt(blankEnd);
        if (blankEnd === source.length || code === 10 || code === 13) {
          offset = blankEnd + (blankEnd < source.length ? 1 : 0);
          if (code === 13 && source.charCodeAt(offset) === 10) {
            offset++;
          }
          continue;
        }
      }
      offset = content;
      if (tokens.length > 0) {
        tokens.push(InlineKind.Newline, offset, offset, 0);
      }
      lineStart = false;
      continue;
    }

    const code = source.charCodeAt(offset);
    if (code === 32 || code === 9) {
      if (code === 32) {
        const end = inlineMarkerRunEnd(source, offset);
        const next = source.charCodeAt(end);
        if (end - offset >= 2 && (next === 10 || next === 13)) {
          tokens.push(InlineKind.HardBreak, offset, end, 0);
          offset = end;
          continue;
        }
        if (end > offset + 1) {
          offset = end;
          continue;
        }
      }
      offset++;
      continue;
    }
    if (code === 10 || code === 13) {
      offset++;
      if (code === 13 && source.charCodeAt(offset) === 10) {
        offset++;
      }
      lineStart = true;
      continue;
    }

    const scan = lexicalByCode[code];
    const lexicalEnd = scan ? scan(source, offset, tokens) : -1;
    if (lexicalEnd > offset) {
      offset = lexicalEnd;
      continue;
    }
    const end = inlineTextEnd(source, offset, textBoundary);
    tokens.push(InlineKind.Text, offset, end, 0);
    offset = end;
  }
  return tokens;
}

export function compileInlineTokenizer(rules: readonly InlineLexicalRule[]): InlineTokenizer {
  const lexicalByCode: (InlineLexicalScanner | undefined)[] = [];
  let extraBoundaries = "";
  for (const rule of rules) {
    if (rule.marker.length !== 1) {
      throw new Error("Inline lexical markers must be one character");
    }
    const code = rule.marker.charCodeAt(0);
    if (lexicalByCode[code]) {
      throw new Error(`Duplicate inline lexical rule for ${JSON.stringify(rule.marker)}`);
    }
    lexicalByCode[code] = rule.scan;
    extraBoundaries += rule.marker
      .replaceAll("\\", "\\\\")
      .replaceAll("]", "\\]")
      .replaceAll("-", "\\-");
  }
  const textBoundary = new RegExp(` {2,}(?=[\\n\\r]|$)|[\\n\\r${extraBoundaries}]`, "g");

  return (source) => tokenize(source, textBoundary, lexicalByCode);
}
