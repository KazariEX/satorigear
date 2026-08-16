export interface SourceLocation {
  column: number;
  line: number;
  offset: number;
}

export interface SourceSpan {
  end: number;
  start: number;
}

export interface TextEdit extends SourceSpan {
  text: string;
}

export interface SourceView {
  readonly text: string;
  mapPoint: (offset: number) => number;
  mapSpan: (start: number, end: number) => SourceSpan;
  shift: (delta: number) => void;
}

export class ContiguousSourceView implements SourceView {
  #offset: number;
  readonly text: string;

  constructor(source: string, start: number, end: number) {
    validateSourceSpan(start, end, source.length);
    this.#offset = start;
    this.text = source.slice(start, end);
  }

  mapPoint(offset: number): number {
    return this.#offset + offset;
  }

  mapSpan(start: number, end: number): SourceSpan {
    return { start: this.#offset + start, end: this.#offset + end };
  }

  shift(delta: number): void {
    this.#offset += delta;
  }
}

export class SegmentedSourceView implements SourceView {
  // Each pair stores sourceStart - viewStart and the cumulative view end.
  #segments: number[];
  readonly text: string;

  constructor(source: string, ranges: number[]) {
    const parts: string[] = [];
    let viewOffset = 0;
    let previousEnd = 0;
    let segmentCount = 0;
    for (let read = 0; read < ranges.length; read += 2) {
      const start = ranges[read];
      const end = ranges[read + 1];
      validateSourceSpan(start, end, source.length);
      if (segmentCount > 0 && start < previousEnd) {
        throw new RangeError(`Source spans must be ordered and non-overlapping: ${start} < ${previousEnd}`);
      }
      if (start === end) {
        continue;
      }
      const write = segmentCount * 2;
      ranges[write] = start - viewOffset;
      viewOffset += end - start;
      parts.push(source.slice(start, end));
      ranges[write + 1] = viewOffset;
      segmentCount++;
      previousEnd = end;
    }
    ranges.length = segmentCount * 2;
    this.#segments = ranges;
    this.text = parts.join("");
  }

  mapPoint(offset: number): number {
    if (this.#segments.length === 0) {
      return 0;
    }
    if (offset === this.text.length) {
      return this.#segments[this.#segments.length - 2] + offset;
    }
    const segment = this.#containingSegment(offset);
    return this.#segments[segment] + offset;
  }

  mapSpan(start: number, end: number): SourceSpan {
    if (this.#segments.length === 0) {
      return { start: 0, end: 0 };
    }
    if (start === end) {
      const point = this.mapPoint(start);
      return { start: point, end: point };
    }
    const first = this.#containingSegment(start);
    const last = this.#containingSegment(end - 1);
    return {
      start: this.#segments[first] + start,
      end: this.#segments[last] + end,
    };
  }

  shift(delta: number): void {
    for (let index = 0; index < this.#segments.length; index += 2) {
      this.#segments[index] += delta;
    }
  }

  #containingSegment(offset: number): number {
    let low = 0;
    let high = this.#segments.length >>> 1;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (offset < this.#segments[middle * 2 + 1]) {
        high = middle;
      }
      else {
        low = middle + 1;
      }
    }
    return low * 2;
  }
}

function validateSourceSpan(start: number, end: number, sourceLength: number): void {
  if (start < 0 || end < start || end > sourceLength) {
    throw new RangeError(`Invalid source span [${start}, ${end}) for source length ${sourceLength}`);
  }
}
