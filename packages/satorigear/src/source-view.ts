export interface SourceLocation {
  line: number;
  column: number;
  offset: number;
}

export interface SourcePosition {
  end: SourceLocation;
  start: SourceLocation;
}

export interface SourceSpan {
  end: number;
  start: number;
}

export interface SourceLocator {
  normalizeLineEndings: (value: string) => string;
  locationAt: (offset: number) => SourceLocation;
  positionAt: (start: number, end: number) => SourcePosition;
}

function containingSegment(segments: number[], offset: number): number {
  let low = 0;
  let high = segments.length >>> 1;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (offset < segments[middle * 2 + 1]) {
      high = middle;
    }
    else {
      low = middle + 1;
    }
  }
  return low * 2;
}

export class SourceView {
  #offset = 0;
  // Segmented views store sourceStart - viewStart and cumulative view end pairs;
  // contiguous views need only the offset above.
  readonly #segments: number[] | undefined;
  readonly text: string;

  constructor(source: string, start: number, end: number);
  constructor(source: string, ranges: number[]);
  constructor(source: string, startOrRanges: number | number[], end?: number) {
    if (typeof startOrRanges === "number") {
      this.#offset = startOrRanges;
      this.text = source.slice(startOrRanges, end);
      return;
    }
    const ranges = startOrRanges;
    const parts: string[] = [];
    let viewOffset = 0;
    let segmentCount = 0;
    for (let read = 0; read < ranges.length; read += 2) {
      const start = ranges[read];
      const end = ranges[read + 1];
      if (start === end) {
        continue;
      }
      const write = segmentCount * 2;
      ranges[write] = start - viewOffset;
      viewOffset += end - start;
      parts.push(source.slice(start, end));
      ranges[write + 1] = viewOffset;
      segmentCount++;
    }
    ranges.length = segmentCount * 2;
    this.#segments = ranges;
    this.text = parts.join("");
  }

  /** Maps an offset at an internal gap to the following source segment. */
  mapOffset(offset: number): number {
    const segments = this.#segments;
    if (!segments) {
      return this.#offset + offset;
    }
    if (offset === this.text.length) {
      return segments[segments.length - 2] + offset;
    }
    const segment = containingSegment(segments, offset);
    return segments[segment] + offset;
  }

  /** Maps an exclusive end at an internal gap to the preceding source segment. */
  mapEnd(offset: number): number {
    const segments = this.#segments;
    if (!segments) {
      return this.#offset + offset;
    }
    const segment = containingSegment(segments, Math.max(0, offset - 1));
    return segments[segment] + offset;
  }

  shift(delta: number): void {
    const segments = this.#segments;
    if (!segments) {
      this.#offset += delta;
      return;
    }
    for (let index = 0; index < segments.length; index += 2) {
      segments[index] += delta;
    }
  }
}
