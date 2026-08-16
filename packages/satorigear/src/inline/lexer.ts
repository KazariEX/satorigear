import { Character } from "../constants/character.ts";
import { InlineKind } from "../constants/inline.ts";
import type { InlineTokenStream } from "./tokens.ts";

type InlineLexicalScanner = (
  source: string,
  start: number,
  tokens: number[],
) => number;

// Features own marker recognition; the compiled lexer only dispatches scanners.
export interface InlineLexicalRule {
  marker: number;
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
  while (match !== null && source.charCodeAt(match.index) === Character.ReverseSolidus) {
    const next = source.charCodeAt(match.index + 1);
    if (next !== Character.Space && next !== Character.CharacterTabulation) {
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
      while (source.charCodeAt(content) === Character.Space) {
        content++;
      }
      if (content === source.length) {
        break;
      }
      let code = source.charCodeAt(content);
      if (code === Character.LineFeed || code === Character.CarriageReturn) {
        offset = content + 1;
        if (code === Character.CarriageReturn && source.charCodeAt(offset) === Character.LineFeed) {
          offset++;
        }
        continue;
      }
      if (code === Character.CharacterTabulation) {
        let blankEnd = content;
        while (
          source.charCodeAt(blankEnd) === Character.CharacterTabulation ||
          source.charCodeAt(blankEnd) === Character.Space
        ) {
          blankEnd++;
        }
        code = source.charCodeAt(blankEnd);
        if (blankEnd === source.length || code === Character.LineFeed || code === Character.CarriageReturn) {
          offset = blankEnd + (blankEnd < source.length ? 1 : 0);
          if (code === Character.CarriageReturn && source.charCodeAt(offset) === Character.LineFeed) {
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
    if (code === Character.Space || code === Character.CharacterTabulation) {
      if (code === Character.Space) {
        const end = inlineMarkerRunEnd(source, offset);
        const next = source.charCodeAt(end);
        if (end - offset >= 2 && (next === Character.LineFeed || next === Character.CarriageReturn)) {
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
    if (code === Character.LineFeed || code === Character.CarriageReturn) {
      offset++;
      if (code === Character.CarriageReturn && source.charCodeAt(offset) === Character.LineFeed) {
        offset++;
      }
      lineStart = true;
      continue;
    }

    const scan = lexicalByCode[code];
    if (scan) {
      const lexicalEnd = scan(source, offset, tokens);
      if (lexicalEnd > offset) {
        offset = lexicalEnd;
        continue;
      }
      // A marker may be shared by multiple features. If none accepts it,
      // include the marker in ordinary text and continue to the next compiled boundary.
      const end = inlineTextEnd(source, offset + 1, textBoundary);
      tokens.push(InlineKind.Text, offset, end, 0);
      offset = end;
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
  const boundaryCodes: number[] = [];
  for (const rule of rules) {
    const code = rule.marker;
    const previous = lexicalByCode[code];
    lexicalByCode[code] = previous === void 0
      ? rule.scan
      : (source, start, tokens) => {
        const end = previous(source, start, tokens);
        return end > start ? end : rule.scan(source, start, tokens);
      };
    if (previous === void 0) {
      boundaryCodes.push(code);
    }
  }
  const boundaries = String.fromCharCode(...boundaryCodes).replaceAll(/[\\\]-]/g, "\\$&");
  const textBoundary = new RegExp(` {2,}(?=[\\n\\r]|$)|[\\n\\r${boundaries}]`, "g");

  return (source) => tokenize(source, textBoundary, lexicalByCode);
}
