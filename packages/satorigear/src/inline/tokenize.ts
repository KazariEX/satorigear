import { Character } from "../constants/character.ts";
import { InlineKind } from "../constants/inline.ts";
import { emptyArray } from "../primitives.ts";
import { inlineTokenCount, inlineTokenEnd, type InlineTokenStream } from "./tokens.ts";

type InlineScanner = (
  source: string,
  start: number,
  tokens: number[],
) => number;

// Features own marker recognition; the compiled lexer only dispatches scanners.
export interface InlineScanRule {
  marker: number;
  scan: InlineScanner;
}

export type InlineTokenizer = (source: string) => InlineTokenStream;

export function matchInlinePatternEnd(pattern: RegExp, source: string, start: number): number {
  pattern.lastIndex = start;
  return pattern.test(source) ? pattern.lastIndex : -1;
}

export function inlineMarkerRunEnd(source: string, start: number): number {
  const marker = source.charCodeAt(start);
  let end = start + 1;
  while (source.charCodeAt(end) === marker) {
    end++;
  }
  return end;
}

function implicitSoftBreak(source: string, start: number, tokens: InlineTokenStream): boolean {
  // A nonempty literal gap proves the text before LF needs no semantic trimming.
  // A token ending at LF may have decoded whitespace or attached attributes.
  if (start <= (tokens.length ? inlineTokenEnd(tokens, inlineTokenCount(tokens) - 1) : 0)) {
    return false;
  }
  const previous = source.charCodeAt(start - 1);
  return previous !== Character.Space && previous !== Character.CharacterTabulation;
}

function nextBoundaryOffset(source: string, boundary: RegExp, offset: number): number {
  if (offset >= source.length) {
    return -1;
  }
  if (source.charCodeAt(offset) === Character.LineFeed) {
    return offset;
  }
  boundary.lastIndex = offset;
  return boundary.test(source) ? boundary.lastIndex - 1 : -1;
}

function tokenize(
  source: string,
  boundary: RegExp,
  scanners: readonly (InlineScanner | undefined)[],
): InlineTokenStream {
  // Ordinary source text stays implicit between semantic tokens; the builder reads those gaps.
  let offset = 0;
  while (source.charCodeAt(offset) === Character.Space) {
    offset++;
  }
  offset = nextBoundaryOffset(source, boundary, offset);
  if (offset < 0) {
    return emptyArray;
  }
  const tokens: number[] = [];
  for (; offset >= 0; offset = nextBoundaryOffset(source, boundary, offset)) {
    const code = source.charCodeAt(offset);
    if (code === Character.LineFeed || code === Character.CarriageReturn) {
      const spacesBreak = (
        source.charCodeAt(offset - 1) === Character.Space &&
        source.charCodeAt(offset - 2) === Character.Space
      );
      const endingStart = offset++;
      if (code === Character.CarriageReturn && source.charCodeAt(offset) === Character.LineFeed) {
        offset++;
      }
      // Block scanning excludes blank lines; continuation indentation is omitted from inline text.
      const lineStart = offset;
      while (source.charCodeAt(offset) === Character.Space) {
        offset++;
      }
      if (spacesBreak) {
        let spaces = endingStart - 2;
        while (source.charCodeAt(spaces - 1) === Character.Space) {
          spaces--;
        }
        // The break absorbs its line ending, so projection spans one token.
        tokens.push(InlineKind.HardBreak, spaces, offset, lineStart);
      }
      else if (
        code !== Character.LineFeed ||
        lineStart !== offset ||
        !implicitSoftBreak(source, endingStart, tokens)
      ) {
        tokens.push(InlineKind.Newline, endingStart, offset, lineStart);
      }
      continue;
    }

    const scannedEnd = scanners[code]?.(source, offset, tokens) ?? offset;
    // Rejected markers and ordinary characters remain implicit source text.
    offset = scannedEnd > offset ? scannedEnd : offset + 1;
  }
  return tokens;
}

function generateInlineTokenizer(
  boundary: RegExp,
  boundaryCodes: readonly number[],
  scanners: readonly (InlineScanner | undefined)[],
): InlineTokenizer {
  const names = boundaryCodes.map((code, index) => `s${index}`);
  const cases = boundaryCodes
    .map((code, index) => `case ${code}:d=s${index}(s,o,t);break;`)
    .join("");

  /** Mirrors {@link tokenize} with short aliases for its generated hot loop. */
  return Function("b", "a", "i", "n", ...names, [
    `return s=>{`,
    `let o=0;while(s.charCodeAt(o)===${Character.Space})o++;`,
    `o=n(s,b,o);if(o<0)return a;const t=[];for(;o>=0;o=n(s,b,o)){`,
    `const c=s.charCodeAt(o);`,
    `if(c===${Character.LineFeed}||c===${Character.CarriageReturn}){`,
    `const k=s.charCodeAt(o-1)===${Character.Space}&&s.charCodeAt(o-2)===${Character.Space};`,
    `const r=o++;if(c===${Character.CarriageReturn}&&s.charCodeAt(o)===${Character.LineFeed})o++;`,
    `const l=o;while(s.charCodeAt(o)===${Character.Space})o++;`,
    `if(k){let h=r-2;while(s.charCodeAt(h-1)===${Character.Space})h--;t.push(${InlineKind.HardBreak},h,o,l)}`,
    `else if(c!==${Character.LineFeed}||l!==o||!i(s,r,t))t.push(${InlineKind.Newline},r,o,l);continue}`,
    `let d;switch(c){${cases}default:d=o}`,
    `o=d>o?d:o+1}`,
    `return t}`,
  ].join(""))(
    boundary,
    emptyArray,
    implicitSoftBreak,
    nextBoundaryOffset,
    ...boundaryCodes.map((code) => scanners[code]!),
  );
}

export function compileInlineTokenizer(rules: readonly InlineScanRule[]): InlineTokenizer {
  const scanners: (InlineScanner | undefined)[] = [];
  const boundaryCodes: number[] = [];
  for (const rule of rules) {
    const code = rule.marker;
    const previous = scanners[code];
    scanners[code] = previous === void 0
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
  // A literal LF is relevant only beside whitespace; the scan loop handles a current LF before this search.
  const boundary = new RegExp(`[\\r${boundaries}]|\\n(?:(?<=[ \t]\\n)|(?= ))`, "g");

  try {
    return generateInlineTokenizer(boundary, boundaryCodes, scanners);
  }
  catch {
    return (source) => tokenize(source, boundary, scanners);
  }
}
