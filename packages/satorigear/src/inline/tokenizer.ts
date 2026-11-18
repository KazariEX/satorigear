import { Character } from "../constants/character.ts";
import { InlineKind } from "../constants/inline.ts";
import { emptyArray } from "../primitives.ts";
import type { InlineTokenStream } from "./tokens.ts";

type InlineScanner = (source: string, start: number, tokens: number[]) => number;

export interface InlineScanRule {
  marker: number;
  scan: InlineScanner;
}

export type InlineTokenizer = (source: string, withBoundaryBreak?: boolean) => InlineTokenStream;

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

function scanLineEnding(source: string, start: number, tokens: number[]): number {
  let next = start + 1;
  if (source.charCodeAt(start) === Character.CarriageReturn && source.charCodeAt(next) === Character.LineFeed) {
    next++;
  }
  // A hard break spans its indentation, while its position ends at the next line start.
  const lineStart = next;
  while (source.charCodeAt(next) === Character.Space) {
    next++;
  }
  if (source.charCodeAt(start - 1) === Character.Space && source.charCodeAt(start - 2) === Character.Space) {
    let spaces = start - 2;
    while (source.charCodeAt(spaces - 1) === Character.Space) {
      spaces--;
    }
    tokens.push(InlineKind.HardBreak, spaces, next, lineStart);
  }
  else {
    tokens.push(InlineKind.Newline, start, next, 0);
  }
  return next;
}

function tokenize(
  source: string,
  boundary: RegExp,
  scanners: readonly (InlineScanner | undefined)[],
): InlineTokenStream {
  // Ordinary source text stays implicit between semantic tokens; the builder reads those gaps.
  boundary.lastIndex = 0;
  if (!boundary.test(source)) {
    return emptyArray;
  }
  const tokens: number[] = [];
  do {
    const offset = boundary.lastIndex - 1;
    const code = source.charCodeAt(offset);
    const scannedEnd = scanners[code]!(source, offset, tokens);
    // Rejected markers and ordinary characters remain implicit source text.
    boundary.lastIndex = scannedEnd > offset ? scannedEnd : offset + 1;
  }
  while (boundary.lastIndex < source.length && boundary.test(source));
  return tokens;
}

function generateInlineTokenizer(
  boundaryFast: RegExp,
  boundarySlow: RegExp,
  codes: readonly number[],
  scanners: readonly (InlineScanner | undefined)[],
): InlineTokenizer {
  const names = codes.map((code, index) => `s${index}`);
  const cases = codes
    .map((code, index) => `case ${code}:d=s${index}(s,o,t);break;`)
    .join("");

  /** Mirrors {@link tokenize} with short aliases for its generated hot loop. */
  return Function("f", "b", "a", ...names, [
    `return(s,u)=>{const x=u?b:f;x.lastIndex=0;if(!x.test(s))return a;`,
    `const t=[];do{const o=x.lastIndex-1;let d;switch(s.charCodeAt(o)){${cases}default:d=o}`,
    `x.lastIndex=d>o?d:o+1}while(x.lastIndex<s.length&&x.test(s));`,
    `return t}`,
  ].join(""))(
    boundaryFast,
    boundarySlow,
    emptyArray,
    ...codes.map((code) => scanners[code]!),
  );
}

export function compileInlineTokenizer(rules: readonly InlineScanRule[]): InlineTokenizer {
  const scanners: (InlineScanner | undefined)[] = [];
  const codes: number[] = [];
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
      codes.push(code);
    }
  }
  const boundaries = String.fromCharCode(...codes).replaceAll(/[\\\]-]/g, "\\$&");
  // Lookaround keeps V8 off the character-class scan. Only a whitespace-adjacent break uses it.
  const boundaryFast = new RegExp(`[\\r${boundaries}]`, "g");
  const boundarySlow = new RegExp(`[\\r${boundaries}]|\\n(?:(?<=[ \\t]\\n)|(?= ))`, "g");
  // The boundary search reports every CR and only whitespace-adjacent LF.
  scanners[Character.LineFeed] = scanLineEnding;
  scanners[Character.CarriageReturn] = scanLineEnding;
  codes.push(Character.LineFeed, Character.CarriageReturn);

  try {
    return generateInlineTokenizer(boundaryFast, boundarySlow, codes, scanners);
  }
  catch {
    return (source, withBoundaryBreak) => tokenize(
      source,
      withBoundaryBreak ? boundarySlow : boundaryFast,
      scanners,
    );
  }
}
