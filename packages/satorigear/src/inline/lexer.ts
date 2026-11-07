import { Character } from "../constants/character.ts";
import { InlineKind } from "../constants/inline.ts";
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

function tokenize(
  source: string,
  textBoundary: RegExp,
  scannerByCode: readonly (InlineScanner | undefined)[],
): InlineTokenStream {
  // Ordinary source text stays implicit between semantic tokens; the builder reads those gaps.
  const tokens: number[] = [];
  const end = source.length;
  let offset = 0;
  while (source.charCodeAt(offset) === Character.Space) {
    offset++;
  }
  for (; offset < end;) {
    textBoundary.lastIndex = offset;
    if (!textBoundary.test(source)) {
      break;
    }
    offset = textBoundary.lastIndex - 1;

    const code = source.charCodeAt(offset);
    if (code === Character.LineFeed || code === Character.CarriageReturn) {
      if (
        source.charCodeAt(offset - 1) === Character.Space &&
        source.charCodeAt(offset - 2) === Character.Space
      ) {
        let spaces = offset - 2;
        while (source.charCodeAt(spaces - 1) === Character.Space) {
          spaces--;
        }
        tokens.push(InlineKind.HardBreak, spaces, offset, 0);
      }
      const endingStart = offset++;
      if (code === Character.CarriageReturn && source.charCodeAt(offset) === Character.LineFeed) {
        offset++;
      }
      // Block scanning excludes blank lines; continuation indentation is omitted from inline text.
      const lineStart = offset;
      while (source.charCodeAt(offset) === Character.Space) {
        offset++;
      }
      if (code !== Character.LineFeed || lineStart !== offset || !implicitSoftBreak(source, endingStart, tokens)) {
        tokens.push(InlineKind.Newline, endingStart, offset, lineStart);
      }
      continue;
    }

    const scannedEnd = scannerByCode[code]?.(source, offset, tokens) ?? offset;
    // Rejected markers and ordinary characters remain implicit source text.
    offset = scannedEnd > offset ? scannedEnd : offset + 1;
  }
  return tokens;
}

function generateInlineTokenizer(
  boundaryCodes: readonly number[],
  textBoundary: RegExp,
  scannerByCode: readonly (InlineScanner | undefined)[],
): InlineTokenizer {
  const names = boundaryCodes.map((code, index) => `s${index}`);
  const cases = boundaryCodes
    .map((code, index) => `case ${code}:d=s${index}(s,o,t);break;`)
    .join("");

  /** Mirrors {@link tokenize} with short aliases for its generated hot loop. */
  return Function("b", "i", ...names, [
    `return s=>{`,
    `const t=[],e=s.length;let o=0;`,
    `while(s.charCodeAt(o)===${Character.Space})o++;for(;o<e;){`,
    `b.lastIndex=o;if(!b.test(s))break;o=b.lastIndex-1;`,
    `const c=s.charCodeAt(o);`,
    `if(c===${Character.LineFeed}||c===${Character.CarriageReturn}){`,
    `if(s.charCodeAt(o-1)===${Character.Space}&&s.charCodeAt(o-2)===${Character.Space}){`,
    `let n=o-2;while(s.charCodeAt(n-1)===${Character.Space})n--;`,
    `t.push(${InlineKind.HardBreak},n,o,0)}`,
    `const r=o++;if(c===${Character.CarriageReturn}&&s.charCodeAt(o)===${Character.LineFeed})o++;`,
    `const l=o;while(s.charCodeAt(o)===${Character.Space})o++;`,
    `if(c!==${Character.LineFeed}||l!==o||!i(s,r,t))t.push(${InlineKind.Newline},r,o,l);continue}`,
    `let d;switch(c){${cases}default:d=o}`,
    `o=d>o?d:o+1}`,
    `return t}`,
  ].join(""))(
    textBoundary,
    implicitSoftBreak,
    ...boundaryCodes.map((code) => scannerByCode[code]!),
  );
}

export function compileInlineTokenizer(rules: readonly InlineScanRule[]): InlineTokenizer {
  const scannerByCode: (InlineScanner | undefined)[] = [];
  const boundaryCodes: number[] = [];
  for (const rule of rules) {
    const code = rule.marker;
    const previous = scannerByCode[code];
    scannerByCode[code] = previous === void 0
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
  const textBoundary = new RegExp(
    // The standard profile has 9 unique markers. With more feature markers,
    // letting the expression start at hard-break spaces advances faster.
    `${boundaryCodes.length > 9 ? " {2,}[\\n\\r]|" : ""}[\\n\\r${boundaries}]`,
    "g",
  );
  try {
    return generateInlineTokenizer(boundaryCodes, textBoundary, scannerByCode);
  }
  catch {
    return (source) => tokenize(source, textBoundary, scannerByCode);
  }
}
