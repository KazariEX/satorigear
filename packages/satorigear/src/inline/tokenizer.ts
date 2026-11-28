import { ScratchView } from "../block/scratch.ts";
import { Character } from "../constants/character.ts";
import { InlineKind } from "../constants/inline.ts";
import { emptyArray } from "../primitives.ts";
import type { InlineTokenStream } from "./tokens.ts";

export interface InlineScanRule {
  marker: number;
  scan: (source: string, start: number, tokens: number[]) => number;
}

export type InlineTokenizer = (
  source: string,
  withBoundaryBreak: boolean,
  // One physical base or pairs of physical delta and exclusive logical end.
  mapping?: number | readonly number[],
) => InlineTokenStream;

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

export function findPatternEnd(source: string, start: number, pattern: RegExp): number {
  pattern.lastIndex = start;
  return pattern.test(source) ? pattern.lastIndex : -1;
}

export function findMarkerRunEnd(source: string, start: number, marker: number): number {
  let end = start + 1;
  while (source.charCodeAt(end) === marker) {
    end++;
  }
  return end;
}

export function findClosingRunEnd(source: string, start: number, width: number, marker: string, code: number): number {
  let close = source.indexOf(marker, start);
  while (close >= 0) {
    const end = findMarkerRunEnd(source, close, code);
    if (end - close === width) {
      return end;
    }
    close = source.indexOf(marker, end);
  }
  return -1;
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

function createBitmap(words: Uint32Array, masks: Uint8Array, group: number): number {
  const i = group >>> 2;
  const word0 = words[i];
  const word1 = words[i | 1];
  const word2 = words[i | 2];
  const word3 = words[i | 3];
  return (
    (masks[word0 & 0xffff] | masks[word0 >>> 16] << 2) |
    (masks[word1 & 0xffff] | masks[word1 >>> 16] << 2) << 4 |
    (masks[word2 & 0xffff] | masks[word2 >>> 16] << 2) << 8 |
    (masks[word3 & 0xffff] | masks[word3 >>> 16] << 2) << 12
  );
}

function tokenizeLatin1(
  scanners: InlineScanRule["scan"][],
  masks: Uint8Array,
  source: string,
  mapping: number | readonly number[],
): InlineTokenStream {
  const words = ScratchView.words;
  const contiguous = typeof mapping === "number";
  let base = contiguous ? mapping : mapping[0];
  let end = contiguous ? source.length : mapping[1];
  let offset = 0;
  let tokens: number[] | undefined;
  for (let index = 2; ; index += 2) {
    const limit = base + end;
    let cursor = base + offset;
    groups: for (let group = cursor & ~15; cursor < limit;) {
      let bits: number;
      let mask = -1 << (cursor & 15);
      do {
        bits = createBitmap(words, masks, group) & mask;
        mask = -1;
      }
      while (!bits && (group += 16) < limit);
      if (!bits) {
        break;
      }
      const groupEnd = group + 16;
      do {
        const markerOffset = group + 31 - Math.clz32(bits & -bits) - base;
        if (markerOffset >= end) {
          break groups;
        }
        const scan = scanners[source.charCodeAt(markerOffset)];
        const next = scan?.(source, markerOffset, tokens ??= []) ?? markerOffset;
        offset = next > markerOffset ? next : markerOffset + 1;
        cursor = base + offset;
        if (cursor >= groupEnd) {
          break;
        }
        bits &= -1 << (cursor & 15);
      }
      while (bits);
      cursor = Math.max(cursor, groupEnd);
      group = cursor & ~15;
    }
    if (contiguous || index >= mapping.length) {
      return tokens ?? emptyArray;
    }
    offset = Math.max(offset, end);
    base = mapping[index];
    end = mapping[index + 1];
  }
}

function createInlineTokenizer(
  boundaryFast: RegExp,
  boundarySlow: RegExp,
  scanners: InlineScanRule["scan"][],
  masks: Uint8Array | undefined,
): InlineTokenizer {
  return (source, withBoundaryBreak, mapping) => {
    if (masks && mapping !== void 0) {
      return tokenizeLatin1(scanners, masks, source, mapping);
    }
    const boundary = withBoundaryBreak ? boundarySlow : boundaryFast;
    let tokens: number[] | undefined;
    for (let cursor = 0; cursor < source.length;) {
      const offset = findPatternEnd(source, cursor, boundary) - 1;
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
  scanners: InlineScanRule["scan"][],
  masks: Uint8Array | undefined,
  codes: number[],
): InlineTokenizer {
  const bindings: Record<string, unknown> = {
    b1: boundaryFast,
    b2: boundarySlow,
    cb: createBitmap,
    ea: emptyArray,
    ms: masks,
    sv: ScratchView,
  };

  const cases: string[] = [];
  for (let index = 0; index < codes.length; index++) {
    const code = codes[index];
    const name = `s${index}`;
    bindings[name] = scanners[code];
    cases.push(`case ${code}:n=${name}(s,mo,t);break;`);
  }

  // Low-byte matches can alias markers, so dispatch checks the UTF-16 code unit.
  const dispatch = `if(t===ea)t=[];let n;switch(s.charCodeAt(mo)){${cases.join("")}default:n=mo}o=n>mo?n:mo+1;`;

  /**
   * Mirrors {@link tokenizeLatin1}.
   * Bitmap bounds are physical, but rules advance the logical offset across segments.
   */
  const scanBitmap = [
    `const l=b+e;let c=b+o;`,
    `g:for(let g=c&~15;c<l;){let bs,m=-1<<(c&15);`,
    `do{bs=cb(w,ms,g)&m;m=-1}while(!bs&&(g+=16)<l);`,
    `if(!bs)break;const ge=g+16;`,
    `do{const mo=g+31-Math.clz32(bs&-bs)-b;if(mo>=e)break g;`,
    dispatch,
    `c=b+o;if(c>=ge)break;bs&=-1<<(c&15)`,
    `}while(bs);c=Math.max(c,ge);g=c&~15}`,
  ].join("");

  return Function(...Object.keys(bindings), [
    masks && [
      // Keep segmented scanning separate so V8 can inline more scanner calls on the contiguous path.
      `function sg(s,mp){`,
      `const w=sv.words;let t=ea,o=0;`,
      `for(let i=0;i<mp.length;i+=2){`,
      `const b=mp[i],e=mp[i+1];if(o>=e)continue;`,
      scanBitmap,
      `o=Math.max(o,e)}return t}`,
    ].join(""),
    `return(s,wb,mp)=>{let t=ea,o=0;`,
    masks && [
      `if(mp!==void 0){`,
      `if(typeof mp!=="number")return sg(s,mp);`,
      `const w=sv.words,b=mp,e=s.length;`,
      scanBitmap,
      `return t}`,
    ].join(""),
    `const b0=wb?b2:b1;while(o<s.length){`,
    `b0.lastIndex=o;if(!b0.test(s))break;`,
    `const mo=b0.lastIndex-1;`,
    dispatch,
    `}return t}`,
  ].join(""))(...Object.values(bindings));
}

// eslint-disable-next-line ts/no-use-before-define
export { create as createInlineTokenizer };

function create(rules: readonly InlineScanRule[]): InlineTokenizer {
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
  const masks = ScratchView.supports && codes.every((code) => code >= 0 && code <= 0xff)
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
    return generateInlineTokenizer(boundaryFast, boundarySlow, scanners, masks, codes);
  }
  catch {
    return createInlineTokenizer(boundaryFast, boundarySlow, scanners, masks);
  }
}
