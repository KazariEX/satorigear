import { ScratchView } from "../block/scratch.ts";
import { Character } from "../constants/character.ts";
import { InlineKind } from "../constants/inline.ts";
import { emptyArray } from "../primitives.ts";
import type { InlineTokenStream } from "./tokens.ts";

export interface InlineScanRule {
  marker: number;
  scan: (source: string, start: number, tokens: number[]) => number;
}

export type InlineTokenizer = (source: string, withBoundaryBreak: boolean, base?: number) => InlineTokenStream;

const cacheMasks = new Map<string, Uint8Array>();

function createMasks(chars: string): Uint8Array {
  let masks = cacheMasks.get(chars);
  if (masks) {
    return masks;
  }
  // Bit 0 records a match in the low byte of the pair, bit 1 in the high byte.
  masks = new Uint8Array(65536);
  for (let i = 0; i < chars.length; i++) {
    const marker = chars.charCodeAt(i);
    for (let byte = 0; byte < 256; byte++) {
      masks[byte << 8 | marker] |= 1;
      masks[marker << 8 | byte] |= 2;
    }
  }
  cacheMasks.set(chars, masks);
  return masks;
}

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

// The low bytes can alias ASCII markers. Dispatch checks the original UTF-16 code unit.
function nextIndexedMarker(masks: Uint8Array, offset: number, limit: number): number {
  const words = ScratchView.words;
  while (offset < limit) {
    const group = offset & ~15;
    const i = group >>> 2;
    const word0 = words[i];
    const word1 = words[i | 1];
    const word2 = words[i | 2];
    const word3 = words[i | 3];
    const bits = -1 << (offset & 15) & (
      (masks[word0 & 0xffff] | masks[word0 >>> 16] << 2) |
      (masks[word1 & 0xffff] | masks[word1 >>> 16] << 2) << 4 |
      (masks[word2 & 0xffff] | masks[word2 >>> 16] << 2) << 8 |
      (masks[word3 & 0xffff] | masks[word3 >>> 16] << 2) << 12
    );
    if (bits) {
      const hit = group + 31 - Math.clz32(bits & -bits);
      return hit < limit ? hit : -1;
    }
    offset = group + 16;
  }
  return -1;
}

function createInlineTokenizer(
  boundaryFast: RegExp,
  boundarySlow: RegExp,
  masks: Uint8Array | undefined,
  scanners: InlineScanRule["scan"][],
): InlineTokenizer {
  return (source, withBoundaryBreak, base) => {
    const boundary = withBoundaryBreak ? boundarySlow : boundaryFast;
    let tokens: number[] | undefined;
    for (let cursor = 0; cursor < source.length;) {
      const offset = base !== void 0 && masks
        ? nextIndexedMarker(masks, base + cursor, base + source.length) - base
        : matchInlinePatternEnd(boundary, source, cursor) - 1;
      if (offset < 0) {
        break;
      }
      const scan = scanners[source.charCodeAt(offset)];
      const end = scan?.(source, offset, tokens ??= []) ?? offset;
      cursor = end > offset ? end : offset + 1;
    }
    return tokens ?? emptyArray;
  };
}

function generateInlineTokenizer(
  boundaryFast: RegExp,
  boundarySlow: RegExp,
  masks: Uint8Array | undefined,
  codes: number[],
  scanners: InlineScanRule["scan"][],
): InlineTokenizer {
  const names = codes.map((code, index) => `s${index}`);
  const cases = codes
    .map((code, index) => `case ${code}:d=s${index}(s,o,t);break;`)
    .join("");

  /** Mirrors CSP fallback with short aliases for its generated hot loop. */
  return Function("f", "b", "a", "m", "v", ...names, [
    `return(s,u,base)=>{const x=u?b:f;`,
    `let t=a,p=0;while(p<s.length){let o;`,
    masks && `if(base!==void 0){o=v(m,base+p,base+s.length)-base;if(o<0)break}else`,
    `{x.lastIndex=p;if(!x.test(s))break;o=x.lastIndex-1}`,
    `if(t===a)t=[];let d;switch(s.charCodeAt(o)){${cases}default:d=o}p=d>o?d:o+1}return t}`,
  ].join(""))(
    boundaryFast,
    boundarySlow,
    emptyArray,
    masks,
    nextIndexedMarker,
    ...codes.map((code) => scanners[code]),
  );
}

export function compileInlineTokenizer(rules: readonly InlineScanRule[]): InlineTokenizer {
  const scanners: InlineScanRule["scan"][] = [];
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

  const markers = String.fromCharCode(...[Character.CarriageReturn, ...codes].sort((a, b) => a - b));
  const masks = codes.every((code) => code >= 0 && code <= 0xff)
    ? createMasks(markers)
    : void 0;

  const boundaries = markers.replaceAll(/[\\\]-]/g, "\\$&");
  // Lookaround keeps V8 off the character-class scan. Only a whitespace-adjacent break uses it.
  const boundaryFast = new RegExp(`[${boundaries}]`, "g");
  const boundarySlow = new RegExp(`[${boundaries}]|\\n(?:(?<=[ \\t]\\n)|(?= ))`, "g");
  // The boundary search reports every CR and only whitespace-adjacent LF.
  scanners[Character.LineFeed] = scanLineEnding;
  scanners[Character.CarriageReturn] = scanLineEnding;
  codes.push(Character.LineFeed, Character.CarriageReturn);

  try {
    return generateInlineTokenizer(boundaryFast, boundarySlow, masks, codes, scanners);
  }
  catch {
    return createInlineTokenizer(boundaryFast, boundarySlow, masks, scanners);
  }
}
