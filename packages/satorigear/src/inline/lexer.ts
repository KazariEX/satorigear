import { Character } from "../constants/character.ts";
import { InlineKind } from "../constants/inline.ts";
import type { InlineTokenStream } from "./tokens.ts";

type InlineScanner = (
  source: string,
  start: number,
  tokens: number[],
) => number;

type InlineScannerDispatch = (
  code: number,
  source: string,
  start: number,
  tokens: number[],
) => number;

type InlineScannerDispatchFactory = (...scanners: InlineScanner[]) => InlineScannerDispatch;

// Cache generated control flow; scanner closures remain profile-specific.
const scannerDispatchFactories = new Map<string, InlineScannerDispatchFactory>();

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

function tokenize(
  source: string,
  textBoundary: RegExp,
  scanBoundary: InlineScannerDispatch,
): InlineTokenStream {
  // Ordinary source text stays implicit between semantic tokens; the builder reads those gaps.
  const tokens: number[] = [];
  const end = source.length;
  // A non-negative offset means the scanner is at the start of that physical line.
  let lineStart = 0;
  let offset = 0;
  while (offset < end) {
    if (lineStart >= 0) {
      // Block scanning excludes blank physical lines from inline regions.
      let content = offset;
      while (source.charCodeAt(content) === Character.Space) {
        content++;
      }
      if (content === end) {
        break;
      }
      offset = content;
      if (lineStart > 0) {
        tokens.push(InlineKind.Newline, offset, offset, lineStart);
      }
      lineStart = -1;
    }

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
      offset++;
      if (code === Character.CarriageReturn && source.charCodeAt(offset) === Character.LineFeed) {
        offset++;
      }
      lineStart = offset;
      continue;
    }

    const scannedEnd = scanBoundary(code, source, offset, tokens);
    // Rejected markers and ordinary characters remain implicit source text.
    offset = scannedEnd > offset ? scannedEnd : offset + 1;
    textBoundary.lastIndex = offset;
    offset = textBoundary.test(source) ? textBoundary.lastIndex - 1 : end;
  }
  return tokens;
}

function compileInlineScannerDispatch(
  boundaryCodes: readonly number[],
  scannerByCode: readonly (InlineScanner | undefined)[],
): InlineScannerDispatch {
  try {
    const key = String.fromCharCode(...boundaryCodes);
    let factory = scannerDispatchFactories.get(key);
    if (factory === void 0) {
      const names = boundaryCodes.map((code, index) => `scan${index}`);
      // eslint-disable-next-line no-new-func
      scannerDispatchFactories.set(key, factory = Function(
        ...names,
        `return(code,source,start,tokens)=>{switch(code){${
          boundaryCodes
            .map((code, index) => `case ${code}:return scan${index}(source,start,tokens);`)
            .join("")
        }default:return start}}`,
      ) as InlineScannerDispatchFactory);
    }
    return factory(...boundaryCodes.map((code) => scannerByCode[code]!));
  }
  catch {
    return (code, source, start, tokens) => scannerByCode[code]?.(source, start, tokens) ?? start;
  }
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
  const scanBoundary = compileInlineScannerDispatch(boundaryCodes, scannerByCode);
  return (source) => tokenize(source, textBoundary, scanBoundary);
}
